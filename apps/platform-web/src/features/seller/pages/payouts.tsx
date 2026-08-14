import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/lib/formatters"
import { Building, Loader2 } from "lucide-react"

export function PayoutsPage() {
  const queryClient = useQueryClient()
  
  const { data: earnings } = useQuery({ queryKey: queryKeys.seller.earnings, queryFn: () => api.seller.earnings.get() })
  const { data: payouts, isLoading } = useQuery({ queryKey: queryKeys.seller.payouts, queryFn: () => api.seller.payouts.list() })

  const mutation = useMutation({
    mutationFn: () => api.seller.payouts.request(earnings?.pending || 0),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.seller.payouts })
      queryClient.invalidateQueries({ queryKey: queryKeys.seller.earnings })
      alert("Payout requested (Mock)")
    }
  })

  return (
    <div className="space-y-8">
      <PageHeader 
        title="Payouts"
        description="Manage your funds and payout history."
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Available Balance</CardTitle>
            <CardDescription>Funds ready to be transferred to your bank account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-4xl font-bold">{earnings ? formatCurrency(earnings.pending) : formatCurrency(0)}</div>
            
            <div className="p-4 border rounded-md bg-surface-hover flex items-center gap-4">
              <div className="h-10 w-10 bg-white rounded-md flex items-center justify-center shadow-sm shrink-0">
                <Building className="h-5 w-5 text-slate-800" />
              </div>
              <div>
                <div className="font-medium">Bank account •••• 1842</div>
                <div className="text-xs text-muted-foreground">Standard transfer (2-3 days)</div>
              </div>
            </div>

            <Button 
              className="w-full" 
              disabled={!earnings?.pending || earnings.pending <= 0 || mutation.isPending}
              onClick={() => {
                if (window.confirm(`Request payout of ${formatCurrency(earnings?.pending || 0)}?`)) {
                  mutation.mutate()
                }
              }}
            >
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Request Payout
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payout History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-4">Loading...</TableCell></TableRow>
                ) : payouts?.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-4 text-muted-foreground">No payouts yet.</TableCell></TableRow>
                ) : (
                  payouts?.map(po => (
                    <TableRow key={po.id}>
                      <TableCell className="text-sm">{new Date(po.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Badge variant={po.status === "paid" ? "success" : "secondary"} className="capitalize">{po.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(po.amount, po.currency)}</TableCell>
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
