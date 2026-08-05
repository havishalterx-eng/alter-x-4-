export interface ServiceHealthTransport {
  getHealth(url: string, signal: AbortSignal): Promise<Response>;
}

export class FetchServiceHealthTransport implements ServiceHealthTransport {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  getHealth(url: string, signal: AbortSignal): Promise<Response> {
    return this.fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
  }
}
