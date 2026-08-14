import { type BillingPlan, type Invoice } from "../types"

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const mockPlans: BillingPlan[] = [
  { id: "plan_free", name: "Free", description: "For individuals and exploration", features: ["1 Workspace", "100 Runs/month", "Community support"], limits: { runs: 100, workspaces: 1 }, current: false },
  { id: "plan_pro", name: "Pro", priceMonthly: 49, description: "For power users and small teams", features: ["Unlimited Workspaces", "5,000 Runs/month", "Email support", "Marketplace Access"], limits: { runs: 5000 }, current: true },
  { id: "plan_business", name: "Business", priceMonthly: 199, description: "For scaling organizations", features: ["Unlimited Workspaces", "50,000 Runs/month", "Priority support", "SSO", "Custom integrations"], limits: { runs: 50000 }, current: false },
  { id: "plan_ent", name: "Enterprise", description: "For large deployments", features: ["Unlimited everything", "Dedicated account manager", "On-premise deployment options", "SLA 99.99%"], limits: { runs: "unlimited" }, current: false },
]

const mockInvoices: Invoice[] = [
  { id: "inv_1", number: "INV-2026-08-01", status: "paid", amount: 49.00, currency: "USD", issuedAt: "2026-08-01T00:00:00Z" },
  { id: "inv_2", number: "INV-2026-07-01", status: "paid", amount: 49.00, currency: "USD", issuedAt: "2026-07-01T00:00:00Z" },
  { id: "inv_3", number: "INV-2026-06-01", status: "paid", amount: 49.00, currency: "USD", issuedAt: "2026-06-01T00:00:00Z" },
]

export const billingService = {
  getSubscription: async () => {
    await delay(300)
    return {
      plan: mockPlans.find(p => p.current),
      status: "active",
      currentPeriodStart: "2026-08-01T00:00:00Z",
      currentPeriodEnd: "2026-09-01T00:00:00Z",
      currentSpend: 284.73
    }
  },
  getPlans: async (): Promise<BillingPlan[]> => {
    await delay(300)
    return mockPlans
  },
  changePlan: async (_planId: string) => {
    await delay(600)
    return true
  },
  getInvoices: async (): Promise<Invoice[]> => {
    await delay(400)
    return mockInvoices
  },
  getPaymentMethod: async () => {
    await delay(300)
    return {
      type: "card",
      brand: "Visa",
      last4: "4242",
      expMonth: 12,
      expYear: 28,
      name: "Jane Doe"
    }
  },
  updatePaymentMethod: async (_data: any) => {
    await delay(1000)
    return true
  }
}
