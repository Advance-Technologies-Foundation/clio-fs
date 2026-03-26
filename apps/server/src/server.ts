import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { healthSummary } from "@clio-fs/sync-core";
import {
  type ApiErrorShape,
  type RegisterWorkspaceInput,
  type WorkspaceRecord
} from "@clio-fs/contracts";
import {
  type WorkspaceRegistry,
  WorkspaceRegistryError
} from "@clio-fs/database";
import { parseRegisterWorkspaceInput } from "./workspace.js";

export interface WorkspaceServerOptions {
  host: string;
  port: number;
  authToken: string;
  registry: WorkspaceRegistry;
}

export interface StartedWorkspaceServer {
  close: () => Promise<void>;
  port: number;
  host: string;
}

const json = (response: ServerResponse, statusCode: number, body: unknown) => {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

const noContent = (response: ServerResponse, statusCode: number) => {
  response.writeHead(statusCode);
  response.end();
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const writeError = (
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
) => {
  const body: ApiErrorShape = {
    error: {
      code,
      message,
      details
    }
  };

  json(response, statusCode, body);
};

const isAuthorized = (request: IncomingMessage, authToken: string) => {
  const header = request.headers.authorization;

  return header === `Bearer ${authToken}`;
};

const publicWorkspaceShape = (workspace: WorkspaceRecord) => ({
  workspaceId: workspace.workspaceId,
  displayName: workspace.displayName,
  status: workspace.status,
  currentRevision: workspace.currentRevision
});

const fullWorkspaceShape = (workspace: WorkspaceRecord) => ({
  workspaceId: workspace.workspaceId,
  displayName: workspace.displayName,
  rootPath: workspace.rootPath,
  platform: workspace.platform,
  status: workspace.status,
  currentRevision: workspace.currentRevision,
  policies: workspace.policies
});

const routeRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: WorkspaceServerOptions
) => {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (method === "GET" && url.pathname === "/health") {
    json(response, 200, {
      status: "ok",
      service: "clio-fs-server",
      summary: healthSummary({ workspaceCount: options.registry.list().length })
    });
    return;
  }

  if (!isAuthorized(request, options.authToken)) {
    writeError(response, 401, "unauthorized", "Missing or invalid bearer token");
    return;
  }

  if (method === "GET" && url.pathname === "/workspaces") {
    json(response, 200, {
      items: options.registry.list().map(publicWorkspaceShape)
    });
    return;
  }

  if (method === "POST" && url.pathname === "/workspaces/register") {
    let input: RegisterWorkspaceInput;

    try {
      const payload = await readJsonBody(request);
      input = parseRegisterWorkspaceInput(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid request body";
      writeError(response, 400, "invalid_request", message);
      return;
    }

    try {
      const workspace = options.registry.register(input);
      json(response, 201, {
        workspaceId: workspace.workspaceId,
        status: workspace.status,
        currentRevision: workspace.currentRevision
      });
      return;
    } catch (error) {
      if (error instanceof WorkspaceRegistryError) {
        const statusCode = error.code === "duplicate_workspace" ? 409 : 400;
        writeError(response, statusCode, error.code, error.message, error.details);
        return;
      }

      throw error;
    }
  }

  if (method === "GET" && url.pathname.startsWith("/workspaces/")) {
    const [, , workspaceId] = url.pathname.split("/");

    if (!workspaceId) {
      writeError(response, 404, "not_found", "Workspace not found");
      return;
    }

    const workspace = options.registry.get(workspaceId);

    if (!workspace) {
      writeError(response, 404, "not_found", "Workspace not found", { workspaceId });
      return;
    }

    json(response, 200, fullWorkspaceShape(workspace));
    return;
  }

  noContent(response, 404);
};

export const createWorkspaceServer = (options: WorkspaceServerOptions) =>
  createServer(async (request, response) => {
    try {
      await routeRequest(request, response, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal server error";
      writeError(response, 500, "internal_error", message);
    }
  });

export const startWorkspaceServer = async (
  options: WorkspaceServerOptions
): Promise<StartedWorkspaceServer> => {
  const server = createWorkspaceServer(options);

  await new Promise<void>((resolve) => {
    server.listen(options.port, options.host, resolve);
  });

  const address = server.address();
  const resolvedPort =
    typeof address === "object" && address && "port" in address ? address.port : options.port;

  console.log(`[server] listening on http://${options.host}:${resolvedPort}`);
  console.log(`[server] ${healthSummary({ workspaceCount: options.registry.list().length })}`);

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
