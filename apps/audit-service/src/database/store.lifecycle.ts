import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";

import {
  AUDIT_STORE_PROVIDER,
  type AuditStoreProvider,
} from "@alterx/shared-clients";

@Injectable()
export class AuditStoreLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(AUDIT_STORE_PROVIDER)
    private readonly store: AuditStoreProvider,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.store.close();
  }
}
