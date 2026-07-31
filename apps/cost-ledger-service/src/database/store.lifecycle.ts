import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";

import { COST_STORE_PROVIDER, type CostStoreProvider } from "./cost-store.token";

@Injectable()
export class CostStoreLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(COST_STORE_PROVIDER)
    private readonly store: CostStoreProvider,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.store.close();
  }
}
