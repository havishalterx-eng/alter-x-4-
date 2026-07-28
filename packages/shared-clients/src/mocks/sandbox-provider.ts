import type { ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import type {
  SandboxFile,
  SandboxProvider,
  SandboxSessionCreateRequest,
} from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_SANDBOX_CAPABILITIES: ProviderCapabilities =
  mockCapabilities(1_048_576);

export interface MockSandboxProvider extends SandboxProvider {
  readonly sessions: ReadonlyMap<string, SandboxSessionCreateRequest>;
  readonly files: ReadonlyMap<string, readonly SandboxFile[]>;
}

export function createMockSandboxProvider(): MockSandboxProvider {
  const sessions = new Map<string, SandboxSessionCreateRequest>();
  const files = new Map<string, readonly SandboxFile[]>();
  let sequence = 0;
  return createMockProvider<MockSandboxProvider>({
    metadata: mockMetadata("mock.sandbox", "SandboxProvider"),
    capabilities: MOCK_SANDBOX_CAPABILITIES,
    implementation: {
      sessions,
      files,
      createSession: async (request) => {
        const sessionId = `ses_mock-${++sequence}`;
        sessions.set(sessionId, request);
        return { sessionId, expiresAt: "1970-01-01T01:00:00.000Z" };
      },
      writeFiles: async (sessionId, nextFiles) => {
        if (!sessions.has(sessionId)) throw new Error("Sandbox session was not found");
        files.set(sessionId, [...nextFiles]);
      },
      readFile: async (sessionId, path) => {
        const file = files.get(sessionId)?.find((entry) => entry.path === path);
        if (file === undefined) throw new Error("Sandbox file was not found");
        return file.content;
      },
      execute: async (sessionId, command) => {
        if (!sessions.has(sessionId)) throw new Error("Sandbox session was not found");
        return { exitCode: 0, stdout: command, stderr: "" };
      },
      closeSession: async (sessionId) => {
        sessions.delete(sessionId);
        files.delete(sessionId);
      },
    },
  });
}
