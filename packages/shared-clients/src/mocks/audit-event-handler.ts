import { randomUUID } from "node:crypto";

import type {
  RecordEventRequest,
  RecordEventResponse,
} from "@alterx/contracts";
import type { AuditEventHandler } from "../audit-ports";

export interface MockAuditEventHandler extends AuditEventHandler {
  getRecordedEvents(): readonly RecordEventRequest[];
}

export interface MockAuditEventHandlerOptions {
  readonly recordEvent?: (
    request: RecordEventRequest,
  ) => Promise<RecordEventResponse>;
}

function defaultRecordEvent(): RecordEventResponse {
  return {
    id: `aud_${randomUUID()}`,
    entry_hash: randomUUID().replaceAll("-", ""),
  };
}

export function createMockAuditEventHandler(
  options: MockAuditEventHandlerOptions = {},
): MockAuditEventHandler {
  const events: RecordEventRequest[] = [];
  const recordEvent = options.recordEvent ?? (async () => defaultRecordEvent());

  return {
    recordEvent: async (request) => {
      events.push({ ...request });
      return recordEvent(request);
    },
    getRecordedEvents: () => events.map((event) => ({ ...event })),
  };
}
