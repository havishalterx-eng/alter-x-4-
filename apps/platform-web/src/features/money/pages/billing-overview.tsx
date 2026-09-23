import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { PageHeader } from "@/components/common/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { api } from "@/api/client"
import { isLiveApi } from "@/api/http"
import { queryKeys } from "@/api/query-keys"
import { formatPlanPeriod, formatProviderMoney } from "../provider-pricing"
import { CreditCard, Package } from "lucide-react"

export function BillingOverviewPage() {
  const navigate = useNavigate()
  const subscription = useQuery({ queryKey: queryKeys.billing.subscription, queryFn: () => api.billing.getSubscription() })
  const plans = useQuery({ queryKey: queryKeys.billing.plans, queryFn: () => api.billing.getPlans() })
  const paymentMethod = useQuery({ queryKey: queryKeys.billing.paymentMethod, queryFn: () => api.billing.getPaymentMethod() })

  if (subscription.isLoading || plans.isLoading || paymentMethod.isLoading) {
    return <div className="p-8 text-muted-foreground animate-pulse">Loading billing...</div>
  }
  const plan = plans.data?.find(item => item.id === subscription.data?.planId)

  return (
    <div className="space-y-8">
      <PageHeader title="Billing Overview" description={isLiveApi ? "Your subscription and payment method." : "Demo subscription and payment method."} />
      {(subscription.isError || plans.isError || paymentMethod.isError) && <p role="alert" className="text-destructive">Could not load all billing details.</p>}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Package className="h-5 w-5 text-primary" /> Current Plan</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {subscription.data ? (
              <>
                <div className="text-3xl font-bold">{plan?.name ?? subscription.data.planId}</div>
                <p className="text-sm text-muted-foreground capitalize">{subscription.data.status}</p>
                {plan && <p className="text-sm">{formatProviderMoney(plan.amount, plan.currency)} {formatPlanPeriod(plan)}</p>}
                {subscription.data.currentPeriodEnd && <p className="text-sm text-muted-foreground">Current period ends {new Date(subscription.data.currentPeriodEnd).toLocaleDateString()}</p>}
              </>
            ) : <p className="text-muted-foreground">{subscription.isError ? "Subscription unavailable." : "No subscription is active."}</p>}
            <Button onClick={() => navigate("/app/billing/plans")}>View Plans</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-primary" /> Payment Method</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {paymentMethod.data ? (
              <p>{paymentMethod.data.brand ?? paymentMethod.data.type} ending in {paymentMethod.data.last4 ?? "••••"}</p>
            ) : <p className="text-muted-foreground">{paymentMethod.isError ? "Payment method unavailable." : "No payment method is attached."}</p>}
            <Button variant="outline" onClick={() => navigate("/app/billing/payment-method")}>View Method</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
