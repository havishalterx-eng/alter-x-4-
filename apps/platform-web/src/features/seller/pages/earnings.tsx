import { useQuery } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCurrency } from "@/lib/formatters"

export function EarningsPage() {
  const { data: earnings, isLoading } = useQuery({
    queryKey: queryKeys.seller.earnings,
    queryFn: () => api.seller.earnings.get()
  })

  return (
    <div className="space-y-8">
      <PageHeader 
        title="Earnings Breakdown"
        description="Detailed view of sales, fees, and net earnings."
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Listing</TableHead>
                <TableHead className="text-right">Sales</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Platform Fee</TableHead>
                <TableHead className="text-right">Net Earnings</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground animate-pulse">Loading earnings...</TableCell>
                </TableRow>
              ) : earnings?.breakdown?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">No earnings data yet.</TableCell>
                </TableRow>
              ) : (
                earnings?.breakdown.map((item: any, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">{item.title}</TableCell>
                    <TableCell className="text-right">{item.sales}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.gross)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">-{formatCurrency(item.platformFee)}</TableCell>
                    <TableCell className="text-right font-bold text-success">{formatCurrency(item.net)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
