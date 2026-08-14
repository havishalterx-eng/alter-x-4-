import { useQuery } from "@tanstack/react-query"
import { PageHeader } from "@/components/common/page-header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { formatCurrency, formatPercentage } from "@/lib/formatters"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Plus, Settings2 } from "lucide-react"

export function BudgetsPage() {
  const { data: budgets, isLoading } = useQuery({
    queryKey: queryKeys.budgets.list,
    queryFn: () => api.budgets.list()
  })

  if (isLoading) return <div className="p-8 text-muted-foreground animate-pulse">Loading budgets...</div>

  return (
    <div className="space-y-8">
      <PageHeader 
        title="Budgets"
        description="Set spending limits and monitor usage before costs become unexpected."
        primaryAction={
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Create Budget
          </Button>
        }
      />

      <div className="grid gap-6">
        {budgets?.map(budget => {
          const ratio = budget.currentSpend / budget.amount
          const percent = formatPercentage(budget.currentSpend, budget.amount)
          
          let statusColor = "bg-primary"
          let statusVariant: "default" | "warning" | "danger" | "success" = "success"
          let statusText = "Healthy"
          
          if (ratio >= 1) {
            statusColor = "bg-danger"
            statusVariant = "danger"
            statusText = "Exceeded"
          } else if (ratio >= 0.8) {
            statusColor = "bg-warning"
            statusVariant = "warning"
            statusText = "Near limit"
          }

          return (
            <Card key={budget.id}>
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div>
                  <CardTitle className="text-lg flex items-center gap-3">
                    {budget.name}
                    <Badge variant={statusVariant}>{statusText}</Badge>
                  </CardTitle>
                  <CardDescription className="capitalize mt-1">
                    {budget.scope} scope • {budget.period}
                  </CardDescription>
                </div>
                <Button variant="ghost" size="icon"><Settings2 className="h-4 w-4" /></Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-end text-sm">
                  <div>
                    <span className="text-2xl font-bold">{formatCurrency(budget.currentSpend, budget.currency)}</span>
                    <span className="text-muted-foreground ml-2">/ {formatCurrency(budget.amount, budget.currency)}</span>
                  </div>
                  <div className="font-medium">{percent}</div>
                </div>
                
                <div className="h-2 w-full bg-surface-hover rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${statusColor} transition-all`} 
                    style={{ width: `${Math.min(ratio * 100, 100)}%` }} 
                  />
                </div>

                <div className="pt-2 flex flex-wrap gap-2">
                  {budget.thresholds.map((t, idx) => (
                    <Badge key={idx} variant="secondary" className="text-xs font-normal">
                      {t.action === 'notify' ? 'Notify' : t.action === 'warn' ? 'Warn' : 'Block'} at {t.percent}%
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )
        })}

        {budgets?.length === 0 && (
          <div className="text-center p-12 border border-dashed rounded-lg">
            <h3 className="text-lg font-medium">No budgets created</h3>
            <p className="text-muted-foreground mt-1">Create a budget to track spending limits.</p>
            <Button className="mt-4"><Plus className="mr-2 h-4 w-4" /> Create Budget</Button>
          </div>
        )}
      </div>
    </div>
  )
}
