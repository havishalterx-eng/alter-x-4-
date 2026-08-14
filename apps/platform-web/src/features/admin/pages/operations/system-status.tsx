import { useQuery } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, Activity, Server, Database, Network } from "lucide-react"

export function SystemStatusPage() {
  const { data: providers, isLoading } = useQuery({
    queryKey: queryKeys.admin.providers.list,
    queryFn: () => api.admin.providers.list()
  })

  // Mock internal components
  const internalComponents = [
    { name: "API Gateway", status: "healthy", icon: Network },
    { name: "Execution Engine", status: "healthy", icon: Activity },
    { name: "Primary Database", status: "healthy", icon: Database },
    { name: "Vector Database", status: "healthy", icon: Database },
    { name: "Background Workers", status: "degraded", icon: Server },
  ]

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <PageHeader 
        title="System Status"
        description="Real-time health of internal components and external providers."
      />

      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-medium text-slate-200 mb-4">Internal Components</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {internalComponents.map((c) => {
              const Icon = c.icon
              return (
                <Card key={c.name} className="p-4 bg-slate-900 border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-800 rounded-md">
                      <Icon className="w-5 h-5 text-slate-400" />
                    </div>
                    <span className="font-medium text-slate-200">{c.name}</span>
                  </div>
                  <Badge variant="outline" className={
                    c.status === "healthy" ? "text-emerald-400 border-emerald-400/20" :
                    c.status === "degraded" ? "text-amber-400 border-amber-400/20" :
                    "text-red-400 border-red-400/20"
                  }>
                    {c.status}
                  </Badge>
                </Card>
              )
            })}
          </div>
        </div>

        <div>
          <h2 className="text-lg font-medium text-slate-200 mb-4">External Providers</h2>
          {isLoading ? (
            <div className="p-8 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {providers?.map((p) => (
                <Card key={p.id} className="p-4 bg-slate-900 border-slate-800">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h4 className="font-medium text-slate-200">{p.name}</h4>
                      <p className="text-xs text-slate-500 capitalize">{p.type}</p>
                    </div>
                    <Badge variant="outline" className={
                      p.status === "healthy" ? "text-emerald-400 border-emerald-400/20" :
                      p.status === "degraded" ? "text-amber-400 border-amber-400/20" :
                      p.status === "outage" ? "text-red-400 border-red-400/20" :
                      "text-slate-400 border-slate-700"
                    }>
                      {p.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-xs mt-4">
                    <div className="flex flex-col">
                      <span className="text-slate-500">Latency</span>
                      <span className={`font-medium ${p.latencyMs && p.latencyMs > 1000 ? 'text-amber-400' : 'text-slate-300'}`}>{p.latencyMs}ms</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-slate-500">Error Rate</span>
                      <span className={`font-medium ${p.errorRate && p.errorRate > 1 ? 'text-red-400' : 'text-slate-300'}`}>{p.errorRate}%</span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
