import type { SandboxServiceClient } from "@alterx/adapters";
import { describe, expect, it, vi } from "vitest";

import {
  GeneratedFileMaterializer,
  GeneratedFileMaterializationError,
  type GeneratedFileArtifactWriter,
} from "./generated-file-materializer";

const TENANT = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const RUN = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const SESSION = "e2b_ses_123";

function harness() {
  let next = 0;
  const contents = new Map<string, Uint8Array>();
  const files = new Map<string, string>();
  const artifacts: GeneratedFileArtifactWriter = {
    create: vi.fn(async (_tenantId, input) => {
      const id = `art_${++next}`;
      contents.set(id, input.bytes);
      return { id, runId: input.runId, contentType: input.contentType, sizeBytes: input.bytes.byteLength, createdAt: "2026-08-05T00:00:00.000Z" };
    }),
  };
  const sandbox: Pick<SandboxServiceClient, "writeFile" | "readFile"> = {
    writeFile: vi.fn(async (request) => {
      const content = contents.get(request.content_artifact_id);
      if (content === undefined) throw new Error("content artifact missing");
      files.set(`${request.session_id}:${request.path}`, new TextDecoder().decode(content));
      return { written: true, size_bytes: content.byteLength };
    }),
    readFile: vi.fn(async (request) => {
      const content = files.get(`${request.session_id}:${request.path}`);
      if (content === undefined) throw new Error("sandbox file missing");
      const artifactId = `read_art_${++next}`;
      const bytes = new TextEncoder().encode(content);
      contents.set(artifactId, bytes);
      return { content_artifact_id: artifactId, size_bytes: bytes.byteLength };
    }),
  };
  return { artifacts, sandbox, files, contents };
}

describe("GeneratedFileMaterializer", () => {
  it("creates artifacts, writes every generated file, and returns a manifest artifact", async () => {
    const fake = harness();
    const result = await new GeneratedFileMaterializer(fake.artifacts, fake.sandbox).materialize({
      tenantId: TENANT, runId: RUN, sessionId: SESSION,
      output: { files: [{ path: "src/index.ts", content: "export const answer = 42;" }, { path: "README.md", content: "# app" }] },
    });

    const read = await fake.sandbox.readFile({
      tenant_id: TENANT, run_id: RUN, session_id: SESSION, path: "src/index.ts",
    });
    expect(new TextDecoder().decode(fake.contents.get(read.content_artifact_id)!)).toBe("export const answer = 42;");
    expect(fake.files.get(`${SESSION}:README.md`)).toBe("# app");
    expect(result.manifestArtifactId).toBe("art_3");
    expect(JSON.parse(new TextDecoder().decode(fake.contents.get(result.manifestArtifactId)!))).toEqual({
      files: [
        { path: "src/index.ts", artifactId: "art_1", sizeBytes: 25 },
        { path: "README.md", artifactId: "art_2", sizeBytes: 5 },
      ],
    });
  });

  it("fails closed before any write when LLM output does not match schema", async () => {
    const fake = harness();
    await expect(new GeneratedFileMaterializer(fake.artifacts, fake.sandbox).materialize({
      tenantId: TENANT, runId: RUN, sessionId: SESSION,
      output: { files: [{ path: "../escape", content: "x" }] },
    })).rejects.toThrow(GeneratedFileMaterializationError);
    expect(fake.artifacts.create).not.toHaveBeenCalled();
    expect(fake.sandbox.writeFile).not.toHaveBeenCalled();
  });

  it("fails closed when project session is missing", async () => {
    const fake = harness();
    await expect(new GeneratedFileMaterializer(fake.artifacts, fake.sandbox).materialize({
      tenantId: TENANT, runId: RUN, sessionId: undefined,
      output: { files: [{ path: "index.ts", content: "x" }] },
    })).rejects.toThrow("provisioning_session_id");
  });
});
