import type { PlatformDeployment } from "../types"

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const MOCK_DEPLOYMENTS: PlatformDeployment[] = [
  { id: "dep-1", environment: "production", version: "v2.14.2", status: "healthy", startedAt: "2024-08-08T02:00:00Z", completedAt: "2024-08-08T02:05:00Z", deployedBy: { id: "u-sys", name: "System Admin" }, commit: "a1b2c3d" },
  { id: "dep-2", environment: "staging", version: "v2.14.3-rc1", status: "healthy", startedAt: "2024-08-09T14:00:00Z", completedAt: "2024-08-09T14:03:00Z", deployedBy: { id: "u-dev", name: "Dev Ops" }, commit: "e4f5g6h" },
  { id: "dep-3", environment: "production", version: "v2.14.1", status: "rolled_back", startedAt: "2024-08-01T02:00:00Z", completedAt: "2024-08-01T02:05:00Z", deployedBy: { id: "u-sys", name: "System Admin" }, commit: "z9y8x7w" }
]

export class DeploymentsService {
  async list(): Promise<PlatformDeployment[]> {
    await delay(300)
    return MOCK_DEPLOYMENTS
  }

  async promote(id: string, toEnvironment: "staging" | "production"): Promise<PlatformDeployment> {
    await delay(800)
    const dep = MOCK_DEPLOYMENTS.find(d => d.id === id)
    if (!dep) throw new Error("Not found")
    const newDep: PlatformDeployment = {
      ...dep,
      id: `dep-${Date.now()}`,
      environment: toEnvironment,
      status: "deploying",
      startedAt: new Date().toISOString(),
      completedAt: undefined
    }
    MOCK_DEPLOYMENTS.unshift(newDep)
    return newDep
  }

  async rollback(id: string, _reason: string): Promise<PlatformDeployment> {
    await delay(600)
    const dep = MOCK_DEPLOYMENTS.find(d => d.id === id)
    if (!dep) throw new Error("Not found")
    dep.status = "rolled_back"
    return dep
  }
}
