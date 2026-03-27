import type {
  ApiErrorShape,
  CreateWorkspaceDirectoryRequest,
  CreateWorkspaceDirectoryResponse,
  DeleteWorkspaceFileRequest,
  DeleteWorkspaceFileResponse,
  MoveWorkspacePathRequest,
  MoveWorkspacePathResponse,
  PutWorkspaceFileRequest,
  PutWorkspaceFileResponse,
  ResolveWorkspaceConflictRequest,
  ResolveWorkspaceConflictResponse,
  ServerWatchSettingsResponse,
  SnapshotMaterializeRequest,
  SnapshotMaterializeResponse,
  WorkspaceChangesResponse,
  WorkspaceSnapshotResponse
} from "@clio-fs/contracts";

export interface ClientControlPlaneOptions {
  baseUrl: string;
  authToken: string;
  fetchImpl?: typeof fetch;
}

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
    this.#baseUrl = options.baseUrl;
    this.#authToken = options.authToken;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async getSnapshot(workspaceId: string): Promise<WorkspaceSnapshotResponse> {
    return this.#request<WorkspaceSnapshotResponse>(
      `/workspaces/${encodeURIComponent(workspaceId)}/snapshot`
    );
  }

  async getWatchSettings(): Promise<ServerWatchSettingsResponse> {
    return this.#request<ServerWatchSettingsResponse>("/settings/watch");
  }

  async materialize(
    workspaceId: string,
    input: SnapshotMaterializeRequest
  ): Promise<SnapshotMaterializeResponse> {
    return this.#request<SnapshotMaterializeResponse>(
      `/workspaces/${encodeURIComponent(workspaceId)}/snapshot-materialize`,
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
    const url = new URL(`/workspaces/${encodeURIComponent(workspaceId)}/file`, this.#baseUrl);
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
    const url = new URL(`/workspaces/${encodeURIComponent(workspaceId)}/file`, this.#baseUrl);
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
    const url = new URL(`/workspaces/${encodeURIComponent(workspaceId)}/mkdir`, this.#baseUrl);
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

  async getChanges(
    workspaceId: string,
    options: { since: number; limit?: number }
  ): Promise<WorkspaceChangesResponse> {
    const url = new URL(
      `/workspaces/${encodeURIComponent(workspaceId)}/changes`,
      this.#baseUrl
    );

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

  async #request<T>(pathOrUrl: string | URL, init?: RequestInit): Promise<T> {
    const response = await this.#fetch(
      pathOrUrl instanceof URL ? pathOrUrl : new URL(pathOrUrl, this.#baseUrl),
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
