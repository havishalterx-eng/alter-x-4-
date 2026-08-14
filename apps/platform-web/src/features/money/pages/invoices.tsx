import { useQuery } from "@tanstack/react-query"
import { PageHeader } from "@/components/common/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { formatCurrency } from "@/lib/formatters"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Download, FileText } from "lucide-react"

export function InvoicesPage() {
  const { data: invoices, isLoading } = useQuery({
    queryKey: queryKeys.billing.invoices,
    queryFn: () => api.billing.getInvoices()
  })

  return (
    <div className="space-y-8">
      <PageHeader 
        title="Invoices"
        description="View and download your billing history."
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice Number</TableHead>
                <TableHead>Issue Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading invoices...</TableCell>
                </TableRow>
              ) : invoices?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No invoices found.</TableCell>
                </TableRow>
              ) : (
                invoices?.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {invoice.number}
                    </TableCell>
                    <TableCell>{new Date(invoice.issuedAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Badge variant={invoice.status === 'paid' ? 'success' : invoice.status === 'failed' ? 'danger' : 'default'} className="capitalize">
                        {invoice.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(invoice.amount, invoice.currency)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => alert("Mock PDF Download")}>
                        <Download className="h-4 w-4 mr-2" /> Download PDF
                      </Button>
                    </TableCell>
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
