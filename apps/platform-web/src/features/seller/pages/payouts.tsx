import { useQuery } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatMinorCurrency } from "@/lib/formatters"

export function PayoutsPage() {
  const { data: earnings, isError: earningsError } = useQuery({ queryKey: queryKeys.seller.earnings, queryFn: () => api.seller.earnings.get() })
  const { data: payouts, isLoading, isError: payoutsError } = useQuery({ queryKey: queryKeys.seller.payouts, queryFn: () => api.seller.payouts.list() })

  return (
    <div className="space-y-8">
      <PageHeader title="Payouts" description="Track seller settlements and payout history." />
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Available earnings</CardTitle>
            <CardDescription>Seller share recorded for orders awaiting settlement.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-4xl font-bold">{earnings ? formatMinorCurrency(earnings.availableMinor, earnings.currency) : "—"}</div>
            {earningsError && <p role="alert" className="text-sm text-destructive">Could not load earnings.</p>}
            <p className="text-sm text-muted-foreground">Payout requests are unavailable. Settlement status will appear here when available.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Payout history</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Seller share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-4">Loading...</TableCell></TableRow>
                ) : payoutsError ? (
                  <TableRow><TableCell colSpan={3} role="alert" className="text-center py-4 text-destructive">Could not load payouts.</TableCell></TableRow>
                ) : payouts?.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-4 text-muted-foreground">No payouts yet.</TableCell></TableRow>
                ) : (
                  payouts?.map(payout => (
                    <TableRow key={payout.id}>
                      <TableCell className="text-sm">{new Date(payout.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell><Badge variant={payout.status === "processed" ? "success" : "secondary"} className="capitalize">{payout.status}</Badge></TableCell>
                      <TableCell className="text-right font-medium">{formatMinorCurrency(payout.sellerShareMinor, earnings?.currency ?? "INR")}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
