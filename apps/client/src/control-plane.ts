import type {
  ApiErrorShape,
  CreateWorkspaceDirectoryRequest,
  CreateWorkspaceDirectoryResponse,
  DeleteWorkspaceFileRequest,
  DeleteWorkspaceFileResponse,
  GetWorkspaceFileResponse,
  GetWorkspaceTreeResponse,
  GitDiffRequest,
  GitDiffResponse,
  GitStatusRequest,
  GitStatusResponse,
  MoveWorkspacePathRequest,
  MoveWorkspacePathResponse,
  PutWorkspaceFileRequest,
  PutWorkspaceFileResponse,
  ResolveWorkspaceConflictRequest,
  ResolveWorkspaceConflictResponse,
  ServerWatchSettingsResponse,
  ServerDiagnosticsSummaryResponse,
  SnapshotMaterializeRequest,
  SnapshotMaterializeResponse,
  WorkspaceChangesStreamEvent,
  WorkspaceChangesResponse,
  WorkspaceDiagnosticsResponse,
  WorkspaceSyncStatusResponse,
  WorkspaceSnapshotResponse
} from "@clio-fs/contracts";

export interface ClientControlPlaneOptions {
  baseUrl: string;
  authToken: string;
  fetchImpl?: typeof fetch;
}

export const normalizeControlPlaneBaseUrl = (input: string) => {
  const url = new URL(input);
  const normalizedPath = url.pathname.replace(/\/+$/u, "");

  if (normalizedPath.length === 0 || normalizedPath === "/api") {
    url.pathname = "/api/";
  }

  url.hash = "";
  return url.toString();
};

export class ControlPlaneRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ControlPlaneRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ClientControlPlane {
  readonly #baseUrl: string;
  readonly #authToken: string;
  readonly #fetch: typeof fetch;

  constructor(options: ClientControlPlaneOptions) {
    this.#baseUrl = normalizeControlPlaneBaseUrl(options.baseUrl);
    this.#authToken = options.authToken;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  #resolveUrl(pathOrUrl: string | URL) {
    if (pathOrUrl instanceof URL) {
      return pathOrUrl;
    }

    return new URL(pathOrUrl.startsWith("/") ? `.${pathOrUrl}` : pathOrUrl, this.#baseUrl);
  }

  async getSnapshot(workspaceId: string): Promise<WorkspaceSnapshotResponse> {
    return this.#request<WorkspaceSnapshotResponse>(
      `/workspaces/${encodeURIComponent(workspaceId)}/snapshot`
    );
  }

  async getWatchSettings(): Promise<ServerWatchSettingsResponse> {
    return this.#request<ServerWatchSettingsResponse>("/settings/watch");
  }

  async getDiagnosticsSummary(): Promise<ServerDiagnosticsSummaryResponse> {
    return this.#request<ServerDiagnosticsSummaryResponse>("/diagnostics/summary");
  }

  async getWorkspaceDiagnostics(workspaceId: string): Promise<WorkspaceDiagnosticsResponse> {
    return this.#request<WorkspaceDiagnosticsResponse>(
      `/workspaces/${encodeURIComponent(workspaceId)}/diagnostics`
    );
  }

  async getSyncStatus(workspaceId: string): Promise<WorkspaceSyncStatusResponse> {
    return this.#request<WorkspaceSyncStatusResponse>(
      `/workspaces/${encodeURIComponent(workspaceId)}/sync-status`
    );
  }

  async materialize(
    workspaceId: string,
    input: SnapshotMaterializeRequest,
    origin = "local-client"
  ): Promise<SnapshotMaterializeResponse> {
    return this.#request<SnapshotMaterializeResponse>(
      `/workspaces/${encodeURIComponent(workspaceId)}/snapshot-materialize?origin=${encodeURIComponent(origin)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(input)
      }
    );
  }

  async putFile(
    workspaceId: string,
    path: string,
    input: PutWorkspaceFileRequest
  ): Promise<PutWorkspaceFileResponse> {
    const url = this.#resolveUrl(`/workspaces/${encodeURIComponent(workspaceId)}/file`);
    url.searchParams.set("path", path);

    return this.#request<PutWorkspaceFileResponse>(url, {
      method: "PUT",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(input)
    });
  }

  async deleteFile(
    workspaceId: string,
    path: string,
    input: DeleteWorkspaceFileRequest
  ): Promise<DeleteWorkspaceFileResponse> {
    const url = this.#resolveUrl(`/workspaces/${encodeURIComponent(workspaceId)}/file`);
    url.searchParams.set("path", path);

    return this.#request<DeleteWorkspaceFileResponse>(url, {
      method: "DELETE",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(input)
    });
  }

  async createDirectory(
    workspaceId: string,
    path: string,
    input: CreateWorkspaceDirectoryRequest
  ): Promise<CreateWorkspaceDirectoryResponse> {
    const url = this.#resolveUrl(`/workspaces/${encodeURIComponent(workspaceId)}/mkdir`);
    url.searchParams.set("path", path);

    return this.#request<CreateWorkspaceDirectoryResponse>(url, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(input)
    });
  }

  async movePath(
    workspaceId: string,
    input: MoveWorkspacePathRequest
  ): Promise<MoveWorkspacePathResponse> {
    return this.#request<MoveWorkspacePathResponse>(
      `/workspaces/${encodeURIComponent(workspaceId)}/move`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(input)
      }
    );
  }

  async getFile(workspaceId: string, path: string): Promise<GetWorkspaceFileResponse> {
    const url = this.#resolveUrl(`/workspaces/${encodeURIComponent(workspaceId)}/file`);
    url.searchParams.set("path", path);
    return this.#request<GetWorkspaceFileResponse>(url);
  }

  async getTree(
    workspaceId: string,
    path: string,
    recursive = false
  ): Promise<GetWorkspaceTreeResponse> {
    const url = this.#resolveUrl(`/workspaces/${encodeURIComponent(workspaceId)}/tree`);
    url.searchParams.set("path", path);
    if (recursive) {
      url.searchParams.set("recursive", "true");
    }
    return this.#request<GetWorkspaceTreeResponse>(url);
  }

  async getGitStatus(workspaceId: string, input: GitStatusRequest): Promise<GitStatusResponse> {
    return this.#request<GitStatusResponse>(
      `/workspaces/${encodeURIComponent(workspaceId)}/git/status`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      }
    );
  }

  async getGitDiff(workspaceId: string, input: GitDiffRequest): Promise<GitDiffResponse> {
    return this.#request<GitDiffResponse>(
      `/workspaces/${encodeURIComponent(workspaceId)}/git/diff`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      }
    );
  }

  async getChanges(
    workspaceId: string,
    options: { since: number; limit?: number }
  ): Promise<WorkspaceChangesResponse> {
    const url = this.#resolveUrl(`/workspaces/${encodeURIComponent(workspaceId)}/changes`);

    url.searchParams.set("since", String(options.since));
    if (typeof options.limit === "number") {
      url.searchParams.set("limit", String(options.limit));
    }

    return this.#request<WorkspaceChangesResponse>(url);
  }

  async resolveConflict(
    workspaceId: string,
    input: ResolveWorkspaceConflictRequest
  ): Promise<ResolveWorkspaceConflictResponse> {
    return this.#request<ResolveWorkspaceConflictResponse>(
      `/workspaces/${encodeURIComponent(workspaceId)}/conflicts/resolve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(input)
      }
    );
  }

  async subscribeChanges(
    workspaceId: string,
    options: {
      since: number;
      signal?: AbortSignal;
      onEvent: (event: WorkspaceChangesStreamEvent) => void;
    }
  ): Promise<void> {
    const url = this.#resolveUrl(`/workspaces/${encodeURIComponent(workspaceId)}/changes/stream`);
    url.searchParams.set("since", String(options.since));

    const response = await this.#fetch(url, {
      headers: {
        authorization: `Bearer ${this.#authToken}`,
        accept: "text/event-stream"
      },
      signal: options.signal
    });

    if (!response.ok || !response.body) {
      const error = (await response.json()) as ApiErrorShape;
      throw new ControlPlaneRequestError(
        response.status,
        error.error.code,
        error.error.message,
        error.error.details
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      buffer += decoder.decode(result.value, { stream: true });

      while (buffer.includes("\n\n")) {
        const separatorIndex = buffer.indexOf("\n\n");
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);

        const dataLines = rawEvent
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart());

        if (dataLines.length === 0) {
          continue;
        }

        const data = dataLines.join("\n");
        if (data === "heartbeat") {
          continue;
        }

        options.onEvent(JSON.parse(data) as WorkspaceChangesStreamEvent);
      }
    }
  }

  async #request<T>(pathOrUrl: string | URL, init?: RequestInit): Promise<T> {
    const response = await this.#fetch(
      this.#resolveUrl(pathOrUrl),
      {
        ...init,
        headers: {
          authorization: `Bearer ${this.#authToken}`,
          ...(init?.headers ?? {})
        }
      }
    );

    if (!response.ok) {
      const error = (await response.json()) as ApiErrorShape;
      throw new ControlPlaneRequestError(
        response.status,
        error.error.code,
        error.error.message,
        error.error.details
      );
    }

    return (await response.json()) as T;
  }
}
