import {
  GeneratedFilesOutputSchema,
  RunIdSchema,
  TenantIdSchema,
  type GeneratedFilesOutput,
} from "@alterx/contracts";
import type { SandboxServiceClient } from "@alterx/adapters";

import type { Artifact } from "../artifacts/artifacts.service";

export interface GeneratedFileArtifactWriter {
  create(
    tenantId: string,
    input: { readonly runId: string; readonly contentType: string; readonly bytes: Uint8Array },
  ): Promise<Artifact>;
}

export interface GeneratedFileMaterialization {
  readonly manifestArtifactId: string;
  readonly files: readonly { readonly path: string; readonly artifactId: string; readonly sizeBytes: number }[];
}

export class GeneratedFileMaterializationError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "GeneratedFileMaterializationError";
  }
}

/**
 * Project build's only generated-file bridge. Model output is validated,
 * stored as tenant-scoped artifacts, then written through Sandbox WriteFile.
 */
export class GeneratedFileMaterializer {
  constructor(
    private readonly artifacts: GeneratedFileArtifactWriter,
    private readonly sandbox: Pick<SandboxServiceClient, "writeFile">,
  ) {}

  async materialize(input: {
    readonly tenantId: string;
    readonly runId: string;
    readonly sessionId: string | undefined;
    readonly projectDirectory: string | undefined;
    readonly output: Record<string, unknown>;
  }): Promise<GeneratedFileMaterialization> {
    if (!TenantIdSchema.safeParse(input.tenantId).success) {
      throw new GeneratedFileMaterializationError("tenantId must be a ten_ prefixed UUIDv7");
    }
    if (!RunIdSchema.safeParse(input.runId).success) {
      throw new GeneratedFileMaterializationError("runId must be a run_ prefixed UUIDv7");
    }
    const sessionId = input.sessionId;
    if (sessionId === undefined || sessionId.trim().length === 0) {
      throw new GeneratedFileMaterializationError(
        "node_generate_code requires the project run provisioning_session_id",
      );
    }
    const projectDirectory = input.projectDirectory;
    if (
      projectDirectory === undefined ||
      !/^\/workspace\/[A-Za-z0-9_-]+$/.test(projectDirectory)
    ) {
      throw new GeneratedFileMaterializationError(
        "node_generate_code requires the provisioned project directory",
      );
    }

    const parsed = GeneratedFilesOutputSchema.safeParse(input.output);
    if (!parsed.success) {
      throw new GeneratedFileMaterializationError(
        `node_generate_code output does not match generated-file schema: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
      );
    }

    const files = await this.#writeFiles({
      tenantId: input.tenantId,
      runId: input.runId,
      sessionId,
      projectDirectory,
    }, parsed.data);
    const manifest = await this.artifacts.create(input.tenantId, {
      runId: input.runId,
      contentType: "application/vnd.alterx.generated-file-manifest+json",
      bytes: new TextEncoder().encode(JSON.stringify({ files })),
    });
    return { manifestArtifactId: manifest.id, files };
  }

  async #writeFiles(
    input: {
      readonly tenantId: string;
      readonly runId: string;
      readonly sessionId: string;
      readonly projectDirectory: string;
    },
    output: GeneratedFilesOutput,
  ): Promise<readonly { readonly path: string; readonly artifactId: string; readonly sizeBytes: number }[]> {
    const files: { path: string; artifactId: string; sizeBytes: number }[] = [];
    for (const file of output.files) {
      const artifact = await this.artifacts.create(input.tenantId, {
        runId: input.runId,
        contentType: "text/plain; charset=utf-8",
        bytes: new TextEncoder().encode(file.content),
      });
      const write = await this.sandbox.writeFile({
        tenant_id: input.tenantId,
        run_id: input.runId,
        session_id: input.sessionId,
        path: `${input.projectDirectory}/${file.path}`,
        content_artifact_id: artifact.id,
      });
      if (!write.written) {
        throw new GeneratedFileMaterializationError(`Sandbox WriteFile did not write ${file.path}`);
      }
      files.push({ path: file.path, artifactId: artifact.id, sizeBytes: artifact.sizeBytes });
    }
    return files;
  }
}
