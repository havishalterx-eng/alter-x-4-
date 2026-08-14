import { useQuery } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Loader2 } from "lucide-react"
import { Link } from "react-router-dom"

export function IncidentsList() {
  const { data: incidents, isLoading } = useQuery({
    queryKey: queryKeys.admin.incidents.list,
    queryFn: () => api.admin.incidents.list()
  })

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <PageHeader 
        title="Incidents"
        description="Active and historical platform incidents."
      />

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-950/50">
            <TableRow className="border-slate-800">
              <TableHead className="text-slate-400">ID / Title</TableHead>
              <TableHead className="text-slate-400">Severity</TableHead>
              <TableHead className="text-slate-400">Status</TableHead>
              <TableHead className="text-slate-400">Started</TableHead>
              <TableHead className="text-slate-400">Commander</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : incidents?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-slate-500">
                  No incidents found.
                </TableCell>
              </TableRow>
            ) : (
              incidents?.map((i) => (
                <TableRow key={i.id} className="border-slate-800 hover:bg-slate-800/50 cursor-pointer group">
                  <TableCell>
                    <Link to={`/app/admin/incidents/${i.id}`} className="block">
                      <div className="font-medium text-slate-200 group-hover:text-primary transition-colors">
                        {i.title}
                      </div>
                      <div className="text-xs text-slate-500">{i.id}</div>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      i.severity === "sev1" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                      i.severity === "sev2" ? "bg-orange-500/10 text-orange-400 border-orange-500/20" :
                      i.severity === "sev3" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                      "bg-primary-soft text-primary border-primary"
                    }>
                      {i.severity.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      i.status === "resolved" ? "text-emerald-400 border-emerald-400/20" :
                      i.status === "monitoring" ? "text-primary border-primary" :
                      "text-amber-400 border-amber-400/20"
                    }>
                      {i.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-300 text-sm">
                    {new Date(i.startedAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-slate-300 text-sm">
                    {i.commander?.name || "Unassigned"}
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
