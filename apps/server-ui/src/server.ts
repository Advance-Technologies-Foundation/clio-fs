import { createServer, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type {
  ApiErrorShape,
  RegisterWorkspaceInput,
  ServerHealthResponse,
  WorkspaceListResponse,
  WorkspaceRecord
} from "@clio-fs/contracts";
import {
  renderMetricCard,
  renderNotice,
  renderPage,
  renderWorkspaceRegistrationForm,
  renderStatusBadge,
  renderWorkspaceTable,
  escapeHtml
} from "@clio-fs/ui-kit";

export interface ServerUiOptions {
  host: string;
  port: number;
  controlPlaneBaseUrl: string;
  controlPlaneAuthToken: string;
  fetchImpl?: typeof fetch;
}

export interface StartedServerUi {
  close: () => Promise<void>;
  host: string;
  port: number;
}

interface ControlPlaneClient {
  getHealth: () => Promise<ServerHealthResponse>;
  listWorkspaces: () => Promise<WorkspaceRecord[]>;
  getWorkspace: (workspaceId: string) => Promise<WorkspaceRecord | null>;
  registerWorkspace: (input: RegisterWorkspaceInput) => Promise<{ workspaceId: string }>;
}

const writeHtml = (response: ServerResponse, statusCode: number, html: string) => {
  response.writeHead(statusCode, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
};

const redirect = (response: ServerResponse, location: string) => {
  response.writeHead(303, { location });
  response.end();
};

const readFormBody = async (request: AsyncIterable<Buffer | string>) => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
};

const createControlPlaneClient = (options: ServerUiOptions): ControlPlaneClient => {
  const fetchImpl = options.fetchImpl ?? fetch;

  const request = async <T>(pathname: string, init?: RequestInit): Promise<T> => {
    const response = await fetchImpl(new URL(pathname, options.controlPlaneBaseUrl), {
      ...init,
      headers: {
        authorization: `Bearer ${options.controlPlaneAuthToken}`,
        ...(init?.headers ?? {})
      }
    });

    if (!response.ok) {
      const error = (await response.json()) as ApiErrorShape;
      throw new Error(error.error.message);
    }

    return (await response.json()) as T;
  };

  return {
    async getHealth() {
      const response = await fetchImpl(new URL("/health", options.controlPlaneBaseUrl));

      if (!response.ok) {
        throw new Error(`Health request failed with ${response.status}`);
      }

      return (await response.json()) as ServerHealthResponse;
    },
    async listWorkspaces() {
      const response = await request<WorkspaceListResponse>("/workspaces");
      const detailRequests = response.items.map((item) =>
        request<WorkspaceRecord>(`/workspaces/${encodeURIComponent(item.workspaceId)}`)
      );

      return Promise.all(detailRequests);
    },
    async getWorkspace(workspaceId: string) {
      const response = await fetchImpl(
        new URL(`/workspaces/${encodeURIComponent(workspaceId)}`, options.controlPlaneBaseUrl),
        {
          headers: {
            authorization: `Bearer ${options.controlPlaneAuthToken}`
          }
        }
      );

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        const error = (await response.json()) as ApiErrorShape;
        throw new Error(error.error.message);
      }

      return (await response.json()) as WorkspaceRecord;
    },
    async registerWorkspace(input: RegisterWorkspaceInput) {
      return request<{ workspaceId: string }>("/workspaces/register", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(input)
      });
    }
  };
};

const renderDashboard = async (
  client: ControlPlaneClient,
  state?: {
    notice?: { tone: "error" | "success"; message: string };
    formValues?: Partial<RegisterWorkspaceInput>;
  }
) => {
  const [health, workspaces] = await Promise.all([client.getHealth(), client.listWorkspaces()]);

  return renderPage(
    "Clio FS Control Plane",
    `
      <section class="hero">
        <div class="eyebrow">Clio FS Operator Surface</div>
        <h1>Control plane visibility without leaving the browser.</h1>
        <p class="lede">This initial UI exposes the live health signal and registered workspaces for the TypeScript control-plane service. It is intentionally server-rendered so operators can use it immediately without building a frontend bundle first.</p>
      </section>
      <section class="grid">
        ${renderMetricCard("Service", health.service)}
        ${renderMetricCard("Health", health.status)}
        ${renderMetricCard("Workspaces", String(workspaces.length))}
      </section>
      ${
        state?.notice ? renderNotice(state.notice.tone, state.notice.message) : ""
      }
      <section class="panel" style="margin-bottom:18px;">
        <div class="metric">Runtime Summary</div>
        <div style="margin-top:10px;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#3f3428;">${escapeHtml(
          health.summary
        )}</div>
      </section>
      ${renderWorkspaceRegistrationForm(state?.formValues)}
      ${renderWorkspaceTable(workspaces)}
    `
  );
};

const renderWorkspaceDetail = (workspace: WorkspaceRecord) =>
  renderPage(
    `${workspace.displayName} | Clio FS`,
    `
      <div class="nav"><a href="/">← Back to dashboard</a></div>
      <section class="hero" style="margin-bottom:20px;">
        <div class="eyebrow">Workspace Detail</div>
        <h1>${escapeHtml(workspace.displayName)}</h1>
        <p class="lede">Operator view for workspace <code>${escapeHtml(
          workspace.workspaceId
        )}</code>.</p>
      </section>
      <section class="grid">
        ${renderMetricCard("Revision", String(workspace.currentRevision))}
        ${renderMetricCard("Platform", workspace.platform)}
        ${renderMetricCard("Status", workspace.status)}
      </section>
      <section class="panel stack">
        <dl class="meta-list">
          <dt>Workspace ID</dt>
          <dd>${escapeHtml(workspace.workspaceId)}</dd>
          <dt>Root Path</dt>
          <dd>${escapeHtml(workspace.rootPath)}</dd>
          <dt>Status</dt>
          <dd>${renderStatusBadge(workspace.status)}</dd>
          <dt>Allow Git</dt>
          <dd>${String(workspace.policies.allowGit)}</dd>
          <dt>Allow Binary Writes</dt>
          <dd>${String(workspace.policies.allowBinaryWrites)}</dd>
          <dt>Max File Bytes</dt>
          <dd>${String(workspace.policies.maxFileBytes)}</dd>
        </dl>
      </section>
    `
  );

const renderNotFound = () =>
  renderPage(
    "Workspace Not Found",
    `
      <div class="nav"><a href="/">← Back to dashboard</a></div>
      <section class="panel error">
        <div class="metric">Not Found</div>
        <div class="metric-value">Workspace not found</div>
      </section>
    `
  );

const renderError = (message: string) =>
  renderPage(
    "Server UI Error",
    `
      <section class="panel error">
        <div class="metric">Operator UI Error</div>
        <div class="metric-value">Unable to load control-plane data</div>
        <p class="lede">${escapeHtml(message)}</p>
      </section>
    `
  );

export const createServerUi = (options: ServerUiOptions) => {
  const client = createControlPlaneClient(options);

  return createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

      if (method === "GET" && url.pathname === "/") {
        writeHtml(response, 200, await renderDashboard(client));
        return;
      }

      if (method === "POST" && url.pathname === "/workspaces/register") {
        const form = await readFormBody(request);
        const input: RegisterWorkspaceInput = {
          workspaceId: form.get("workspaceId")?.toString() ?? "",
          displayName: form.get("displayName")?.toString() ?? "",
          rootPath: form.get("rootPath")?.toString() ?? "",
          platform: (form.get("platform")?.toString() ?? "linux") as RegisterWorkspaceInput["platform"]
        };

        try {
          const result = await client.registerWorkspace(input);
          redirect(response, `/workspaces/${encodeURIComponent(result.workspaceId)}`);
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to register workspace";
          writeHtml(
            response,
            400,
            await renderDashboard(client, {
              notice: { tone: "error", message },
              formValues: input
            })
          );
          return;
        }
      }

      if (method === "GET" && url.pathname.startsWith("/workspaces/")) {
        const [, , workspaceId] = url.pathname.split("/");

        if (!workspaceId) {
          writeHtml(response, 404, renderNotFound());
          return;
        }

        const workspace = await client.getWorkspace(workspaceId);

        if (!workspace) {
          writeHtml(response, 404, renderNotFound());
          return;
        }

        writeHtml(response, 200, renderWorkspaceDetail(workspace));
        return;
      }

      if (method !== "GET" && method !== "POST") {
        response.writeHead(405);
        response.end();
        return;
      }

      response.writeHead(404);
      response.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown UI error";
      writeHtml(response, 500, renderError(message));
    }
  });
};

export const startServerUi = async (options: ServerUiOptions): Promise<StartedServerUi> => {
  const server = createServerUi(options);

  await new Promise<void>((resolve) => {
    server.listen(options.port, options.host, resolve);
  });

  const address = server.address();
  const resolvedPort =
    typeof address === "object" && address && "port" in address ? address.port : options.port;

  console.log(`[server-ui] listening on http://${options.host}:${resolvedPort}`);
  console.log(`[server-ui] control plane ${options.controlPlaneBaseUrl}`);

  return {
    host: options.host,
    port: resolvedPort,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
};
