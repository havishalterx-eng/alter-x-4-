import { beforeEach, describe, expect, it, vi } from "vitest"

// A small, targeted set of contract tests proving the isLiveApi branch
// pattern in client.ts actually dispatches to live.ts (and passes
// arguments through correctly), for a handful of RBAC/security-adjacent
// methods -- not a re-test of live.ts's own HTTP logic (http.spec.ts and
// live.ts's own internals cover that separately), and explicitly not an
// attempt at comprehensive coverage of all 117 client.ts methods.
//
// vi.mock calls are hoisted above these imports by Vitest, so isLiveApi
// is forced true and every live.* export client.ts might call is a bare
// vi.fn() before client.ts itself is ever imported below -- no
// vi.resetModules()/dynamic-import dance needed for this file, unlike
// http.spec.ts's baseUrl/isLiveApi env tests (there is no other, simpler
// way to toggle isLiveApi from inside client.ts's own structure -- it's a
// plain imported constant, not a parameter).
vi.mock("./http", () => ({
  isLiveApi: true,
  mutationKey: (prefix: string) => `${prefix}-test-key`,
}))

vi.mock("./live", () => ({
  getCredential: vi.fn(),
  updateCredential: vi.fn(),
  replaceCredentialSecret: vi.fn(),
  deleteCredential: vi.fn(),
  deleteConnection: vi.fn(),
}))

import { api } from "./client"
import * as live from "./live"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("client.ts isLiveApi branch contracts", () => {
  it("getCredential(id) calls live.getCredential with the same id and returns its result", async () => {
    const credential = { id: "cred_1", name: "Prod key" }
    vi.mocked(live.getCredential).mockResolvedValue(credential as never)

    const result = await api.getCredential("cred_1")

    expect(live.getCredential).toHaveBeenCalledExactlyOnceWith("cred_1")
    expect(result).toBe(credential)
  })

  it("updateCredential(id, data) passes both arguments through in order, not transposed", async () => {
    const updated = { id: "cred_1", name: "Renamed" }
    vi.mocked(live.updateCredential).mockResolvedValue(updated as never)
    const patch = { name: "Renamed" }

    const result = await api.updateCredential("cred_1", patch)

    expect(live.updateCredential).toHaveBeenCalledExactlyOnceWith("cred_1", patch)
    expect(result).toBe(updated)
  })

  it("replaceCredentialSecret(id, secretValue) forwards the id and the real secret value untouched", async () => {
    const rotated = { id: "cred_1", maskedValue: "sk_••••" }
    vi.mocked(live.replaceCredentialSecret).mockResolvedValue(rotated as never)

    const result = await api.replaceCredentialSecret("cred_1", "sk_live_real_secret_value")

    expect(live.replaceCredentialSecret).toHaveBeenCalledExactlyOnceWith(
      "cred_1",
      "sk_live_real_secret_value",
    )
    expect(result).toBe(rotated)
  })

  it("deleteCredential(id) calls live.deleteCredential with the same id", async () => {
    vi.mocked(live.deleteCredential).mockResolvedValue(undefined)

    await api.deleteCredential("cred_1")

    expect(live.deleteCredential).toHaveBeenCalledExactlyOnceWith("cred_1")
  })

  it("deleteConnection(id) calls live.deleteConnection (the real revoke action), not a silent local no-op", async () => {
    vi.mocked(live.deleteConnection).mockResolvedValue(undefined)

    await api.deleteConnection("conn_1")

    expect(live.deleteConnection).toHaveBeenCalledExactlyOnceWith("conn_1")
  })
})
