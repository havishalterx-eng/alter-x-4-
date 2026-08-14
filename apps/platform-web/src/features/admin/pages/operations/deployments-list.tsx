import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loader2, ArrowUpCircle, RotateCcw } from "lucide-react"

export function DeploymentsList() {
  const queryClient = useQueryClient()

  const { data: deployments, isLoading } = useQuery({
    queryKey: queryKeys.admin.deployments.list,
    queryFn: () => api.admin.deployments.list()
  })

  const promoteMutation = useMutation({
    mutationFn: ({ id, env }: { id: string, env: "staging" | "production" }) => api.admin.deployments.promote(id, env),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.deployments.list })
  })

  const rollbackMutation = useMutation({
    mutationFn: (id: string) => api.admin.deployments.rollback(id, "Admin request"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.deployments.list })
  })

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader 
          title="Platform Deployments"
          description="View active versions across environments and manage rollouts."
        />
        <Button disabled>New Deployment</Button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-950/50">
            <TableRow className="border-slate-800">
              <TableHead className="text-slate-400">Environment</TableHead>
              <TableHead className="text-slate-400">Version</TableHead>
              <TableHead className="text-slate-400">Commit</TableHead>
              <TableHead className="text-slate-400">Status</TableHead>
              <TableHead className="text-slate-400">Deployed</TableHead>
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
            ) : deployments?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-slate-500">
                  No deployments found.
                </TableCell>
              </TableRow>
            ) : (
              deployments?.map((d) => (
                <TableRow key={d.id} className="border-slate-800">
                  <TableCell>
                    <Badge variant="outline" className={
                      d.environment === "production" ? "bg-primary-soft text-primary border-primary" :
                      d.environment === "staging" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                      "bg-slate-800 text-slate-300 border-slate-700"
                    }>
                      {d.environment}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium text-slate-200">{d.version}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm text-slate-400">{d.commit}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      d.status === "healthy" ? "text-emerald-400 border-emerald-400/20" :
                      d.status === "deploying" ? "text-primary border-primary animate-pulse" :
                      d.status === "rolled_back" ? "text-slate-400 border-slate-700" :
                      "text-red-400 border-red-400/20"
                    }>
                      {d.status.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-slate-300">
                      {d.startedAt ? new Date(d.startedAt).toLocaleString() : 'N/A'}
                    </div>
                    <div className="text-xs text-slate-500">{d.deployedBy?.name}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {d.status === "healthy" && d.environment !== "production" && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          title="Promote to Production"
                          onClick={() => promoteMutation.mutate({ id: d.id, env: "production" })}
                          className="h-8 w-8 text-emerald-400 hover:bg-emerald-400/10"
                        >
                          <ArrowUpCircle className="w-4 h-4" />
                        </Button>
                      )}
                      {(d.status === "healthy" || d.status === "degraded") && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          title="Rollback"
                          onClick={() => rollbackMutation.mutate(d.id)}
                          className="h-8 w-8 text-amber-400 hover:bg-amber-400/10"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
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
