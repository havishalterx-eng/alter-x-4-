import { useQuery } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency } from "@/lib/formatters"
import { BarChart, DollarSign, Download, List } from "lucide-react"

export function SellerDashboardPage() {
  const { data: profile } = useQuery({ queryKey: queryKeys.seller.profile, queryFn: () => api.seller.getProfile() })
  const { data: earnings } = useQuery({ queryKey: queryKeys.seller.earnings, queryFn: () => api.seller.earnings.get() })

  return (
    <div className="space-y-8">
      <PageHeader 
        title="Seller Dashboard"
        description="Publish and manage assets for the AlterX Marketplace."
      />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Lifetime Earnings</CardTitle>
            <DollarSign className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{earnings ? formatCurrency(earnings.lifetime) : formatCurrency(0)}</div>
            <p className="text-xs text-muted-foreground mt-1">All time</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Current Period</CardTitle>
            <BarChart className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{earnings ? formatCurrency(earnings.currentPeriod) : formatCurrency(0)}</div>
            <p className="text-xs text-muted-foreground mt-1">This month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Published Listings</CardTitle>
            <List className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{profile?.listingCount || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Active</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Installs</CardTitle>
            <Download className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">5.4k</div>
            <p className="text-xs text-muted-foreground mt-1">Across all assets</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
