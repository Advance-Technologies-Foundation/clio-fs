import { createHash } from "node:crypto";
import type { FileTransferEncoding } from "@clio-fs/contracts";

export const hashBytes = (content: Uint8Array) =>
  `sha256:${createHash("sha256").update(content).digest("hex")}`;

export const decodeTransferContent = (content: string, encoding: FileTransferEncoding): Buffer => {
  if (encoding === "base64") {
    return Buffer.from(content, "base64");
  }

  return Buffer.from(content, "utf8");
};

export const detectTransferEncoding = (
  content: Uint8Array
): { encoding: FileTransferEncoding; content: string } => {
  const buffer = Buffer.from(content);
  const utf8 = buffer.toString("utf8");

  if (Buffer.from(utf8, "utf8").equals(buffer)) {
    return {
      encoding: "utf8",
      content: utf8
    };
  }

  return {
    encoding: "base64",
    content: buffer.toString("base64")
  };
};
