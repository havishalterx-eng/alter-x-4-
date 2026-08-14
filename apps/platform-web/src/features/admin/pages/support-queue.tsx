import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loader2, Check, X, ShieldAlert } from "lucide-react"

export function SupportQueue() {
  const queryClient = useQueryClient()
  
  const { data: requests, isLoading } = useQuery({
    queryKey: queryKeys.admin.support.requests,
    queryFn: () => api.admin.support.list()
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.admin.support.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.support.requests })
    }
  })

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <PageHeader 
        title="Support Access Queue"
        description="Manage temporary impersonation and data access requests."
      />

      <div className="bg-amber-500/10 border border-amber-500/20 text-amber-500 p-4 rounded-md flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="text-sm font-medium">Impersonation Warning</h4>
          <p className="text-sm mt-1">
            Approving these requests grants the specified agent access to customer tenant data.
            All actions taken during the session will be heavily audited and visibly flagged as "Support Action" to the customer.
          </p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-950/50">
            <TableRow className="border-slate-800">
              <TableHead className="text-slate-400">Agent</TableHead>
              <TableHead className="text-slate-400">Tenant</TableHead>
              <TableHead className="text-slate-400">Reason</TableHead>
              <TableHead className="text-slate-400">Scope</TableHead>
              <TableHead className="text-slate-400">Status</TableHead>
              <TableHead className="text-slate-400 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : requests?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-slate-500">
                  No support requests.
                </TableCell>
              </TableRow>
            ) : (
              requests?.map((req) => (
                <TableRow key={req.id} className="border-slate-800">
                  <TableCell>
                    <div className="font-medium text-slate-200">{req.requestedBy.name}</div>
                    <div className="text-xs text-slate-500">{new Date(req.requestedAt).toLocaleDateString()}</div>
                  </TableCell>
                  <TableCell>
                    <span className="text-slate-300 font-mono text-sm">{req.tenantId}</span>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-slate-300" title={req.reason}>
                    {req.reason}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {req.scope?.map(s => (
                        <Badge key={s} variant="outline" className="text-[10px] whitespace-nowrap bg-slate-800/50">{s}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      req.status === "approved" ? "text-emerald-400 border-emerald-400/20" :
                      req.status === "pending" ? "text-amber-400 border-amber-400/20" :
                      "text-slate-400 border-slate-700"
                    }>
                      {req.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {req.status === "pending" && (
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10" onClick={() => approveMutation.mutate(req.id)}>
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-400/10">
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
