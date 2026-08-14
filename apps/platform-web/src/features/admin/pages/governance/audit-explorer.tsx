import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Loader2, Search, Filter } from "lucide-react"

export function AuditExplorer() {
  const [tenantFilter, setTenantFilter] = useState("")
  
  const { data: audits, isLoading } = useQuery({
    queryKey: queryKeys.admin.audit.list(tenantFilter ? { tenantId: tenantFilter } : {}),
    queryFn: () => api.admin.audit.list(tenantFilter ? { tenantId: tenantFilter } : {})
  })

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <PageHeader 
        title="Audit Explorer"
        description="Global platform audit logs."
      />

      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input 
            placeholder="Filter by Tenant ID..." 
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
            className="pl-9 bg-slate-900 border-slate-800"
          />
        </div>
        <button className="px-4 py-2 bg-slate-900 border border-slate-800 rounded-md text-slate-300 flex items-center gap-2 hover:bg-slate-800">
          <Filter className="w-4 h-4" /> Filters
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-950/50">
            <TableRow className="border-slate-800">
              <TableHead className="text-slate-400">Timestamp</TableHead>
              <TableHead className="text-slate-400">Actor</TableHead>
              <TableHead className="text-slate-400">Action</TableHead>
              <TableHead className="text-slate-400">Tenant ID</TableHead>
              <TableHead className="text-slate-400">IP Address</TableHead>
              <TableHead className="text-slate-400">Outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : audits?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-slate-500">
                  No audit events found.
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
                  <TableCell className="text-slate-400">{a.tenantId || "-"}</TableCell>
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
