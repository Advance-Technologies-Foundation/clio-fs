import type {
  ApiErrorShape,
  PutWorkspaceFileRequest,
  PutWorkspaceFileResponse,
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
      throw new Error(error.error.message);
    }

    return (await response.json()) as T;
  }
}
