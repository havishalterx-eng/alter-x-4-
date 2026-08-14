import { useQuery } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Loader2 } from "lucide-react"

export function SettingsAudit() {
  const { data: audits, isLoading } = useQuery({
    queryKey: queryKeys.admin.audit.list({ tenantId: "ten-1" }), // Mocking current tenant filter
    queryFn: () => api.admin.audit.list({ tenantId: "ten-1" })
  })

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Audit Logs"
        description="Review security events and actions taken within your workspace."
      />

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-950/50">
            <TableRow className="border-slate-800">
              <TableHead className="text-slate-400">Timestamp</TableHead>
              <TableHead className="text-slate-400">Actor</TableHead>
              <TableHead className="text-slate-400">Action</TableHead>
              <TableHead className="text-slate-400">IP Address</TableHead>
              <TableHead className="text-slate-400">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : audits?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-slate-500">
                  No audit events found for your workspace.
                </TableCell>
              </TableRow>
            ) : (
              audits?.map((a) => (
                <TableRow key={a.id} className="border-slate-800 font-mono text-sm">
                  <TableCell className="text-slate-400 whitespace-nowrap">
                    {new Date(a.timestamp).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className="text-slate-200">{a.actor.name}</div>
                    <div className="text-xs text-slate-500">{a.actor.type}</div>
                  </TableCell>
                  <TableCell className="text-slate-300">{a.action}</TableCell>
                  <TableCell className="text-slate-500">{a.ipAddress}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      a.outcome === "success" ? "text-emerald-400 border-emerald-400/20" :
                      a.outcome === "failure" ? "text-red-400 border-red-400/20" :
                      "text-amber-400 border-amber-400/20"
                    }>
                      {a.outcome}
                    </Badge>
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
