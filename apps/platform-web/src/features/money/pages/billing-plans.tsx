import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { PageHeader } from "@/components/common/page-header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { formatCurrency } from "@/lib/formatters"
import { Button } from "@/components/ui/button"
import { Check, Loader2 } from "lucide-react"

export function BillingPlansPage() {
  const queryClient = useQueryClient()
  const { data: plans, isLoading } = useQuery({
    queryKey: queryKeys.billing.plans,
    queryFn: () => api.billing.getPlans()
  })

  const mutation = useMutation({
    mutationFn: (planId: string) => api.billing.changePlan(planId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.billing.subscription })
      alert("Plan updated (Mock)")
    }
  })

  if (isLoading) return <div className="p-8 text-muted-foreground animate-pulse">Loading plans...</div>

  return (
    <div className="space-y-8">
      <PageHeader 
        title="Subscription Plans"
        description="Choose the right plan for your team's usage and feature requirements."
      />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {plans?.map((plan) => (
          <Card key={plan.id} className={plan.current ? "border-primary shadow-md relative" : ""}>
            {plan.current && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-primary text-primary-foreground text-xs font-medium px-3 py-1 rounded-full">
                Current Plan
              </div>
            )}
            <CardHeader>
              <CardTitle>{plan.name}</CardTitle>
              <CardDescription className="h-10">{plan.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <span className="text-3xl font-bold">{plan.priceMonthly ? formatCurrency(plan.priceMonthly) : "Free"}</span>
                {plan.priceMonthly && <span className="text-muted-foreground text-sm"> / mo</span>}
              </div>
              <ul className="space-y-3 text-sm">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Button 
                variant={plan.current ? "outline" : "primary"}
                className="w-full"
                disabled={plan.current || mutation.isPending}
                onClick={() => {
                  if (plan.priceMonthly && !plan.current) {
                    if (window.confirm(`Upgrade to ${plan.name} for ${formatCurrency(plan.priceMonthly)} / month?`)) {
                      mutation.mutate(plan.id)
                    }
                  } else {
                    mutation.mutate(plan.id)
                  }
                }}
              >
                {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : plan.current ? "Current" : "Upgrade"}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  )
}
