import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loader2, ToggleLeft, ToggleRight } from "lucide-react"

export function FeatureFlagsPage() {
  const queryClient = useQueryClient()
  
  const { data: flags, isLoading } = useQuery({
    queryKey: queryKeys.admin.featureFlags.list,
    queryFn: () => api.admin.featureFlags.list()
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string, enabled: boolean }) => api.admin.featureFlags.update(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.featureFlags.list })
  })

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <PageHeader 
        title="Feature Flags"
        description="Manage rollout of beta features and killswitches."
      />

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-950/50">
            <TableRow className="border-slate-800">
              <TableHead className="text-slate-400">Feature</TableHead>
              <TableHead className="text-slate-400">Key</TableHead>
              <TableHead className="text-slate-400">Scope</TableHead>
              <TableHead className="text-slate-400">Status</TableHead>
              <TableHead className="text-slate-400 text-right">Toggle</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : flags?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-slate-500">
                  No feature flags found.
                </TableCell>
              </TableRow>
            ) : (
              flags?.map((f) => (
                <TableRow key={f.id} className="border-slate-800">
                  <TableCell>
                    <div className="font-medium text-slate-200">{f.name}</div>
                    <div className="text-xs text-slate-500">{f.description}</div>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm text-slate-400">{f.key}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-slate-800 text-slate-300 border-slate-700 capitalize">
                      {f.scope}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      f.enabled ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                      "bg-slate-800 text-slate-400 border-slate-700"
                    }>
                      {f.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => toggleMutation.mutate({ id: f.id, enabled: !f.enabled })}
                      className={f.enabled ? "text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10" : "text-slate-400 hover:text-slate-300 hover:bg-slate-800"}
                    >
                      {f.enabled ? <ToggleRight className="w-6 h-6" /> : <ToggleLeft className="w-6 h-6" />}
                    </Button>
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
