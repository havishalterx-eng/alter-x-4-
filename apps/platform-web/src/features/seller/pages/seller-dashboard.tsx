import { useQuery } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatMinorCurrency } from "@/lib/formatters"

export function SellerDashboardPage() {
  const { data: earnings, isError } = useQuery({ queryKey: queryKeys.seller.earnings, queryFn: () => api.seller.earnings.get() })
  const balances = [
    { label: "Available earnings", minor: earnings?.availableMinor },
    { label: "Settlement pending", minor: earnings?.pendingMinor },
    { label: "Processed payouts", minor: earnings?.paidMinor },
  ]

  return (
    <div className="space-y-8">
      <PageHeader title="Seller Dashboard" description="Marketplace earnings and settlements." />
      {isError && <p role="alert" className="text-sm text-destructive">Could not load earnings.</p>}
      <div className="grid gap-6 md:grid-cols-3">
        {balances.map(balance => (
          <Card key={balance.label}>
            <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{balance.label}</CardTitle></CardHeader>
            <CardContent className="text-3xl font-bold">{earnings && balance.minor ? formatMinorCurrency(balance.minor, earnings.currency) : "—"}</CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
