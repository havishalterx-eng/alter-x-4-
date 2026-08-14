const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export interface BillingIssue {
  id: string
  tenantId: string
  tenantName: string
  issue: "failed_renewal" | "payment_failed" | "plan_mismatch" | "budget_exceeded" | "credit_request"
  plan: string
  amount: number
  currency: string
  status: "open" | "resolved"
  createdAt: string
}

const MOCK_ISSUES: BillingIssue[] = [
  { id: "bill-1", tenantId: "ten-2", tenantName: "Stark Industries", issue: "failed_renewal", plan: "pro", amount: 250, currency: "USD", status: "open", createdAt: new Date(Date.now() - 48 * 3600000).toISOString() },
  { id: "bill-2", tenantId: "ten-3", tenantName: "Wayne Enterprises", issue: "payment_failed", plan: "enterprise", amount: 1500, currency: "USD", status: "open", createdAt: new Date(Date.now() - 24 * 3600000).toISOString() },
  { id: "bill-3", tenantId: "ten-1", tenantName: "Acme AI", issue: "credit_request", plan: "enterprise", amount: 50, currency: "USD", status: "resolved", createdAt: "2024-07-01T00:00:00Z" }
]

export class BillingOpsService {
  async listIssues(): Promise<BillingIssue[]> {
    await delay(300)
    return MOCK_ISSUES
  }

  async resolve(id: string): Promise<BillingIssue> {
    await delay(400)
    const issue = MOCK_ISSUES.find(i => i.id === id)
    if (!issue) throw new Error("Not found")
    issue.status = "resolved"
    return issue
  }

  async applyCredit(tenantId: string, amount: number, reason: string): Promise<void> {
    await delay(600)
    console.log(`Applied credit of ${amount} to ${tenantId} for ${reason}`)
  }

  async retryBilling(id: string): Promise<BillingIssue> {
    await delay(500)
    return this.resolve(id)
  }
}
