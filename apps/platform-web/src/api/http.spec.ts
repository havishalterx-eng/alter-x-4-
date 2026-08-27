import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiHttpError, apiDelete, apiGet, apiPatch, apiPost, apiRequest, mutationKey } from "./http"

function fakeResponse(status: number, text: string | undefined, statusText = ""): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText,
    text: () => Promise.resolve(text ?? ""),
  } as unknown as Response
}

describe("apiRequest -- success path", () => {
  it("returns the parsed JSON body and always sends Accept + credentials: include", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, JSON.stringify({ hello: "world" })))
    vi.stubGlobal("fetch", fetchMock)

    const result = await apiRequest<{ hello: string }>("/things")

    expect(result).toEqual({ hello: "world" })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain("/things")
    expect(init.credentials).toBe("include")
    expect((init.headers as Headers).get("Accept")).toBe("application/json, application/problem+json")
  })

  it("returns undefined for a 204 response without ever reading the body", async () => {
    // A deliberately malformed body: if readPayload ran anyway, JSON.parse
    // would throw. It shouldn't be called at all -- the code returns early
    // on response.status === 204, before readPayload.
    const text = vi.fn().mockResolvedValue("{{{ not valid json")
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 204, ok: true, statusText: "No Content", text } as unknown as Response),
    )

    const result = await apiRequest("/x")

    expect(result).toBeUndefined()
    expect(text).not.toHaveBeenCalled()
  })
})

describe("apiRequest -- body serialization", () => {
  it("serializes options.body as JSON and sets Content-Type only when a body is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, "{}"))
    vi.stubGlobal("fetch", fetchMock)

    await apiRequest("/with-body", { method: "POST", body: { a: 1 } })
    const [, initWithBody] = fetchMock.mock.calls[0]!
    expect(initWithBody.body).toBe(JSON.stringify({ a: 1 }))
    expect((initWithBody.headers as Headers).get("Content-Type")).toBe("application/json")

    fetchMock.mockClear()
    await apiRequest("/without-body")
    const [, initWithoutBody] = fetchMock.mock.calls[0]!
    expect(initWithoutBody.body).toBeUndefined()
    expect((initWithoutBody.headers as Headers).get("Content-Type")).toBeNull()
  })
})

describe("apiRequest -- idempotencyKey/ifMatch headers", () => {
  it("sets Idempotency-Key and If-Match only when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, "{}"))
    vi.stubGlobal("fetch", fetchMock)

    await apiRequest("/x", { idempotencyKey: "key-1", ifMatch: '"etag-1"' })
    const [, init] = fetchMock.mock.calls[0]!
    expect((init.headers as Headers).get("Idempotency-Key")).toBe("key-1")
    expect((init.headers as Headers).get("If-Match")).toBe('"etag-1"')

    fetchMock.mockClear()
    await apiRequest("/y")
    const [, init2] = fetchMock.mock.calls[0]!
    expect((init2.headers as Headers).get("Idempotency-Key")).toBeNull()
    expect((init2.headers as Headers).get("If-Match")).toBeNull()
  })
})

describe("apiRequest -- error mapping (toApiError)", () => {
  it.each([
    [{ error_code: "A" }, "A"],
    [{ code: "B" }, "B"],
    [{ title: "C" }, "C"],
    [{}, "HTTP_400"],
  ])("maps the error code through error_code ?? code ?? title ?? HTTP_<status> (%o -> %s)", async (body, expectedCode) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(400, JSON.stringify(body))))

    await expect(apiRequest("/x")).rejects.toMatchObject({
      name: "ApiHttpError",
      status: 400,
      error: expect.objectContaining({ code: expectedCode }),
    })
  })

  it("maps the message through detail ?? message ?? statusText", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(400, JSON.stringify({ detail: "D" }), "Bad Request")))
    await expect(apiRequest("/x")).rejects.toMatchObject({ error: { message: "D" } })

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(400, JSON.stringify({ message: "M" }), "Bad Request")))
    await expect(apiRequest("/x")).rejects.toMatchObject({ error: { message: "M" } })

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(400, JSON.stringify({}), "Bad Request")))
    await expect(apiRequest("/x")).rejects.toMatchObject({ error: { message: "Bad Request" } })
  })

  it("maps requestId through request_id ?? requestId", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(400, JSON.stringify({ requestId: "camel" }))))
    await expect(apiRequest("/x")).rejects.toMatchObject({ error: { requestId: "camel" } })

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(400, JSON.stringify({ request_id: "snake" }))))
    await expect(apiRequest("/x")).rejects.toMatchObject({ error: { requestId: "snake" } })
  })

  it("uses the raw text as the message when the error body isn't valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(fakeResponse(500, "Internal server exploded", "Internal Server Error")),
    )

    await expect(apiRequest("/x")).rejects.toMatchObject({
      status: 500,
      error: { code: "HTTP_500", message: "Internal server exploded" },
    })
  })

  it("falls back to HTTP_<status>/statusText when the error response has no body at all", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(503, undefined, "Service Unavailable")))

    await expect(apiRequest("/x")).rejects.toMatchObject({
      status: 503,
      error: { code: "HTTP_503", message: "Service Unavailable" },
    })
    expect(await apiRequest("/x").catch((error: ApiHttpError) => error)).toBeInstanceOf(ApiHttpError)
  })
})

describe("apiGet/apiPost/apiPatch/apiDelete shims", () => {
  it.each([
    ["apiGet", () => apiGet("/x"), "GET"],
    ["apiPost", () => apiPost("/x", { a: 1 }), "POST"],
    ["apiPatch", () => apiPatch("/x", { a: 1 }), "PATCH"],
    ["apiDelete", () => apiDelete("/x"), "DELETE"],
  ] as const)("%s reaches fetch with method=%s", async (_name, call, method) => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, "{}"))
    vi.stubGlobal("fetch", fetchMock)

    await call()

    expect(fetchMock.mock.calls[0]![1].method).toBe(method)
  })
})

describe("mutationKey", () => {
  it("matches the prefix-timestamp-random shape and differs across calls", () => {
    const a = mutationKey("run-create")
    const b = mutationKey("run-create")

    expect(a).toMatch(/^run-create-\d+-[a-z0-9]+$/)
    expect(b).toMatch(/^run-create-\d+-[a-z0-9]+$/)
    expect(a).not.toBe(b)
  })
})

// baseUrl and isLiveApi are computed once at module load from
// import.meta.env.VITE_API_BASE_URL/VITE_API_MODE. Every other describe
// block above imports http.ts statically at the top of this file, once,
// before any test runs -- vi.resetModules()/vi.stubEnv() below only affect
// *future* dynamic import() calls, never those already-bound static
// imports, so this block is safe to run in any order relative to the rest
// of the file.
describe("baseUrl and isLiveApi (module-load-time env computation)", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("strips a trailing slash from a configured base URL", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com/")
    vi.resetModules()
    const mod = await import("./http")

    expect(mod.baseUrl).toBe("https://api.example.com")
  })

  it("collapses a base URL of exactly '/' to an empty string", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "/")
    vi.resetModules()
    const mod = await import("./http")

    expect(mod.baseUrl).toBe("")
  })

  it("defaults to an empty string when VITE_API_BASE_URL is unset", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "")
    vi.resetModules()
    const mod = await import("./http")

    expect(mod.baseUrl).toBe("")
  })

  it("isLiveApi is true only when VITE_API_MODE is exactly 'live'", async () => {
    vi.stubEnv("VITE_API_MODE", "live")
    vi.resetModules()
    const live = await import("./http")
    expect(live.isLiveApi).toBe(true)

    vi.stubEnv("VITE_API_MODE", "mock")
    vi.resetModules()
    const notLive = await import("./http")
    expect(notLive.isLiveApi).toBe(false)
  })
})
