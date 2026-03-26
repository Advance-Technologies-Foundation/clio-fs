import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceDescriptor } from "@clio-fs/contracts";

test("workspace descriptor shape stays minimal and explicit", () => {
  const workspace: WorkspaceDescriptor = {
    workspaceId: "main",
    currentRevision: 1
  };

  assert.equal(workspace.workspaceId, "main");
  assert.equal(workspace.currentRevision, 1);
  assert.equal(workspace.displayName, undefined);
});
