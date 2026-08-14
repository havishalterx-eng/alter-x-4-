import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { PageHeader } from "@/components/common/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { formatCurrency } from "@/lib/formatters"
import { Button } from "@/components/ui/button"
import { CreditCard, Package, Calendar } from "lucide-react"

export function BillingOverviewPage() {
  const navigate = useNavigate()
  
  const { data: sub, isLoading: loadingSub } = useQuery({
    queryKey: queryKeys.billing.subscription,
    queryFn: () => api.billing.getSubscription()
  })
  const { data: paymentMethod, isLoading: loadingPm } = useQuery({
    queryKey: queryKeys.billing.paymentMethod,
    queryFn: () => api.billing.getPaymentMethod()
  })

  if (loadingSub || loadingPm || !sub || !paymentMethod) {
    return <div className="p-8 text-muted-foreground animate-pulse">Loading billing...</div>
  }

  return (
    <div className="space-y-8">
      <PageHeader 
        title="Billing Overview"
        description="Manage your subscription, view current spend, and update payment details."
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" /> Current Plan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-3xl font-bold">{sub.plan?.name}</div>
              <p className="text-sm text-muted-foreground mt-1">
                {sub.plan?.priceMonthly ? `${formatCurrency(sub.plan.priceMonthly)} / month` : "Free tier"}
              </p>
            </div>
            <div className="pt-4 border-t border-border flex items-center justify-between">
              <div className="text-sm">
                <div className="text-muted-foreground">Current spend</div>
                <div className="font-semibold">{formatCurrency(sub.currentSpend)}</div>
              </div>
              <Button onClick={() => navigate("/app/billing/plans")}>Change Plan</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary" /> Payment Method
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-lg font-medium flex items-center gap-2">
                {paymentMethod.brand} •••• {paymentMethod.last4}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Expires {paymentMethod.expMonth.toString().padStart(2, '0')}/{paymentMethod.expYear}
              </p>
            </div>
            <div className="pt-4 border-t border-border flex items-center justify-between">
              <div className="text-sm flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-4 w-4" /> Next invoice on {new Date(sub.currentPeriodEnd).toLocaleDateString()}
              </div>
              <Button variant="outline" onClick={() => navigate("/app/billing/payment-method")}>Update</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
