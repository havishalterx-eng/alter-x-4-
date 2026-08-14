import { useParams, Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loader2, ArrowLeft, CheckCircle2 } from "lucide-react"

export function IncidentDetail() {
  const { incidentId } = useParams<{ incidentId: string }>()
  const queryClient = useQueryClient()
  
  const { data: incident, isLoading } = useQuery({
    queryKey: queryKeys.admin.incidents.detail(incidentId!),
    queryFn: () => api.admin.incidents.get(incidentId!),
    enabled: !!incidentId
  })

  const resolveMutation = useMutation({
    mutationFn: () => api.admin.incidents.update(incidentId!, { status: "resolved" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.incidents.detail(incidentId!) })
    }
  })

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
      </div>
    )
  }

  if (!incident) return <div className="p-8 text-slate-400">Incident not found</div>

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <Link to="/app/admin/incidents" className="inline-flex items-center text-sm text-slate-400 hover:text-slate-200 transition-colors">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Incidents
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-100">{incident.title}</h1>
            <Badge variant="outline" className={
              incident.severity === "sev1" ? "bg-red-500/10 text-red-400 border-red-500/20" :
              incident.severity === "sev2" ? "bg-orange-500/10 text-orange-400 border-orange-500/20" :
              incident.severity === "sev3" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
              "bg-primary-soft text-primary border-primary"
            }>
              {incident.severity.toUpperCase()}
            </Badge>
            <Badge variant="outline" className={
              incident.status === "resolved" ? "text-emerald-400 border-emerald-400/20" :
              incident.status === "monitoring" ? "text-primary border-primary" :
              "text-amber-400 border-amber-400/20"
            }>
              {incident.status}
            </Badge>
          </div>
          <p className="text-slate-400 mt-1">ID: {incident.id}</p>
        </div>
        <div>
          {incident.status !== "resolved" && (
            <Button onClick={() => resolveMutation.mutate()} disabled={resolveMutation.isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {resolveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
              Mark Resolved
            </Button>
          )}
        </div>
      </div>

      <Card className="p-6 bg-slate-900 border-slate-800 space-y-6">
        <div>
          <h3 className="text-sm font-medium text-slate-400 mb-2">Summary</h3>
          <p className="text-slate-200">{incident.summary || "No summary provided."}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-medium text-slate-400 mb-2">Affected Systems</h3>
            <ul className="list-disc list-inside text-slate-300">
              {incident.affectedSystems.map(s => <li key={s}>{s}</li>)}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-medium text-slate-400 mb-2">Timeline</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Started</span>
                <span className="text-slate-200">{new Date(incident.startedAt).toLocaleString()}</span>
              </div>
              {incident.resolvedAt && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Resolved</span>
                  <span className="text-emerald-400">{new Date(incident.resolvedAt).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div>
           <h3 className="text-sm font-medium text-slate-400 mb-2">Commander</h3>
           <p className="text-slate-200">{incident.commander?.name || "Unassigned"}</p>
        </div>
      </Card>
    </div>
  )
}
