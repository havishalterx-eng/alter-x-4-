import type { ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import {
  auditGenesisHash,
  calculateAuditEntryHash,
  type AuditEventToAppend,
  type AuditStoreProvider,
  type DeletionCertificateToStore,
  type DeletionLedgerEntry,
  type StoredAuditEvent,
} from "../audit-ports";
import type { ProviderMetadata } from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_AUDIT_STORE_CAPABILITIES: ProviderCapabilities =
  mockCapabilities(8_192);

export interface MockAuditStoreProvider extends AuditStoreProvider {
  snapshot(): readonly StoredAuditEvent[];
  deletionCertificates(): readonly DeletionCertificateToStore[];
  deletionLedger(): readonly DeletionLedgerEntry[];
}

export interface MockAuditStoreProviderOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"AuditStoreProvider">;
  readonly capabilities?: ProviderCapabilities;
}

function cloneEvent(event: StoredAuditEvent): StoredAuditEvent {
  return {
    ...event,
    context: event.context === null ? null : structuredClone(event.context),
    occurredAt: new Date(event.occurredAt),
    prevHash: Buffer.from(event.prevHash),
    entryHash: Buffer.from(event.entryHash),
  };
}

export function createMockAuditStoreProvider(
  options: MockAuditStoreProviderOptions = {},
): MockAuditStoreProvider {
  const providerId = options.providerId ?? "mock.audit-store";
  const events: StoredAuditEvent[] = [];
  const certificates: DeletionCertificateToStore[] = [];
  const ledger: DeletionLedgerEntry[] = [];
  let appendBarrier: Promise<void> = Promise.resolve();

  const append = async (event: AuditEventToAppend): Promise<StoredAuditEvent> => {
    let stored: StoredAuditEvent | undefined;
    const operation = appendBarrier.then(() => {
      const prevHash = events.at(-1)?.entryHash ?? auditGenesisHash();
      const pending = { ...event, prevHash };
      stored = { ...pending, entryHash: calculateAuditEntryHash(pending) };
      events.push(stored);
    });
    appendBarrier = operation.catch(() => undefined);
    await operation;
    if (stored === undefined) {
      throw new Error("Mock audit append produced no event");
    }
    return cloneEvent(stored);
  };

  return createMockProvider<MockAuditStoreProvider>({
    metadata:
      options.metadata ?? mockMetadata(providerId, "AuditStoreProvider"),
    capabilities: options.capabilities ?? MOCK_AUDIT_STORE_CAPABILITIES,
    implementation: {
      migrate: async () => undefined,
      append,
      readGlobalChain: async () => events.map(cloneEvent),
      storeDeletionCertificate: async (certificate) => {
        certificates.push(structuredClone(certificate));
      },
      appendDeletionLedger: async (entry) => {
        ledger.push(structuredClone(entry));
      },
      storeDeletionCompletion: async (certificate, entry) => {
        certificates.push(structuredClone(certificate));
        ledger.push(structuredClone(entry));
      },
      listDeletionLedgerSince: async (since) =>
        ledger.filter((entry) => entry.deletedAt >= since).map((entry) => structuredClone(entry)),
      close: async () => undefined,
      snapshot: () => events.map(cloneEvent),
      deletionCertificates: () => certificates.map((entry) => structuredClone(entry)),
      deletionLedger: () => ledger.map((entry) => structuredClone(entry)),
    },
  });
}
