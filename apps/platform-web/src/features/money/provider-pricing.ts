import type { BillingPlan } from "@/api/types"

export function formatProviderMoney(amountMinor: number, currency: string): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error("Invalid provider amount")
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amountMinor / 100)
}

export function formatPlanPeriod(plan: BillingPlan): string {
  const unit = plan.period === "daily" ? "day" : plan.period === "weekly" ? "week" : plan.period === "yearly" ? "year" : "month"
  return plan.interval === 1 ? `per ${unit}` : `per ${plan.interval} ${unit}s`
}
