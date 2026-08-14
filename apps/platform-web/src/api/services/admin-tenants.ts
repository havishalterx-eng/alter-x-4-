import type { AdminTenant, AdminNote } from "../types"

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const MOCK_TENANTS: AdminTenant[] = [
  { id: "ten-1", name: "Acme AI", slug: "acme-ai", status: "active", plan: "enterprise", memberCount: 142, workflowCount: 23, runCount30d: 45023, currentSpend: 3450.00, createdAt: "2024-01-15T00:00:00Z", lastActiveAt: new Date().toISOString(), region: "us-east", riskState: "normal" },
  { id: "ten-2", name: "Stark Industries", slug: "stark", status: "restricted", plan: "pro", memberCount: 5, workflowCount: 2, runCount30d: 800, currentSpend: 250.00, createdAt: "2024-03-20T00:00:00Z", lastActiveAt: new Date().toISOString(), region: "us-west", riskState: "review" },
  { id: "ten-3", name: "Wayne Enterprises", slug: "wayne", status: "suspended", plan: "free", memberCount: 1, workflowCount: 0, runCount30d: 0, currentSpend: 0, createdAt: "2024-06-10T00:00:00Z", region: "eu-central", riskState: "restricted" }
]

const MOCK_NOTES: Record<string, AdminNote[]> = {
  "ten-2": [
    { id: "note-1", tenantId: "ten-2", author: { id: "u-sys", name: "Admin (You)" }, body: "Restricted due to suspicious spike in API usage. Awaiting response.", createdAt: "2024-08-09T14:00:00Z" }
  ]
}

export class AdminTenantsService {
  async list(): Promise<AdminTenant[]> {
    await delay(400)
    return MOCK_TENANTS
  }

  async get(id: string): Promise<AdminTenant> {
    await delay(300)
    const tenant = MOCK_TENANTS.find(t => t.id === id)
    if (!tenant) throw new Error("Tenant not found")
    return tenant
  }

  async getNotes(id: string): Promise<AdminNote[]> {
    await delay(200)
    return MOCK_NOTES[id] || []
  }

  async addNote(id: string, body: string): Promise<AdminNote> {
    await delay(300)
    const newNote: AdminNote = {
      id: `note-${Date.now()}`,
      tenantId: id,
      author: { id: "u-sys", name: "Admin (You)" },
      body,
      createdAt: new Date().toISOString()
    }
    if (!MOCK_NOTES[id]) MOCK_NOTES[id] = []
    MOCK_NOTES[id].push(newNote)
    return newNote
  }

  async suspend(id: string, reason: string): Promise<AdminTenant> {
    await delay(500)
    const idx = MOCK_TENANTS.findIndex(t => t.id === id)
    if (idx === -1) throw new Error("Not found")
    MOCK_TENANTS[idx] = { ...MOCK_TENANTS[idx], status: "suspended" }
    await this.addNote(id, `Suspended. Reason: ${reason}`)
    return MOCK_TENANTS[idx]
  }

  async restore(id: string, reason: string): Promise<AdminTenant> {
    await delay(500)
    const idx = MOCK_TENANTS.findIndex(t => t.id === id)
    if (idx === -1) throw new Error("Not found")
    MOCK_TENANTS[idx] = { ...MOCK_TENANTS[idx], status: "active", riskState: "normal" }
    await this.addNote(id, `Restored. Reason: ${reason}`)
    return MOCK_TENANTS[idx]
  }

  async restrict(id: string, reason: string): Promise<AdminTenant> {
    await delay(500)
    const idx = MOCK_TENANTS.findIndex(t => t.id === id)
    if (idx === -1) throw new Error("Not found")
    MOCK_TENANTS[idx] = { ...MOCK_TENANTS[idx], status: "restricted", riskState: "review" }
    await this.addNote(id, `Restricted. Reason: ${reason}`)
    return MOCK_TENANTS[idx]
  }
}
