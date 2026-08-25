import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { PermissionGate } from "../components/permission-gate"
import { usePermissions } from "./usePermissions"

function PermissionProbe() {
  const { role, can, canAll, canAny } = usePermissions()
  return <output>{JSON.stringify({
    role,
    canManageCredentials: can("credential.manage"),
    canAll: canAll(["workflow.update", "credential.manage"]),
    canAny: canAny(["admin.access", "billing.manage"]),
  })}</output>
}

describe("usePermissions", () => {
  it("keeps the current hardcoded owner contract until RBAC wiring lands", () => {
    const html = renderToStaticMarkup(<PermissionProbe />)

    expect(html).toContain("&quot;role&quot;:&quot;owner&quot;")
    expect(html).toContain("&quot;canManageCredentials&quot;:true")
    expect(html).toContain("&quot;canAll&quot;:true")
    expect(html).toContain("&quot;canAny&quot;:true")
  })

  it("allows downstream permission gates to render owner-authorized UI", () => {
    const html = renderToStaticMarkup(
      <PermissionGate permission="credential.manage">
        <button>Store credential</button>
      </PermissionGate>,
    )

    expect(html).toContain("Store credential")
  })
})
