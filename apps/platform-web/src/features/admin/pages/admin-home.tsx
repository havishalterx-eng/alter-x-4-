import { useQuery } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Card } from "@/components/ui/card"
import { Shield, Building2, Activity, AlertCircle } from "lucide-react"
import { AdminAttentionQueue } from "../components/admin-attention-queue"
import { Link } from "react-router-dom"

export function AdminHome() {
  const { data: tenants } = useQuery({
    queryKey: queryKeys.admin.tenants.list,
    queryFn: () => api.admin.tenants.list()
  })

  const { data: incidents } = useQuery({
    queryKey: queryKeys.admin.incidents.list,
    queryFn: () => api.admin.incidents.list()
  })

  const { data: providers } = useQuery({
    queryKey: queryKeys.admin.providers.list,
    queryFn: () => api.admin.providers.list()
  })

  const activeIncidents = incidents?.filter(i => i.status !== "resolved") || []
  const degradedProviders = providers?.filter(p => p.status !== "healthy") || []

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <PageHeader 
        title="Admin Overview"
        description="Platform operations, governance, and business administration."
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4 bg-slate-900 border-slate-800">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-slate-400">Total Tenants</p>
              <h3 className="text-2xl font-semibold text-slate-100 mt-1">{tenants?.length || 0}</h3>
            </div>
            <div className="p-2 bg-primary-soft text-primary rounded-md">
              <Building2 className="w-5 h-5" />
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-slate-900 border-slate-800">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-slate-400">Open Incidents</p>
              <h3 className="text-2xl font-semibold text-slate-100 mt-1">{activeIncidents.length}</h3>
            </div>
            <div className={`p-2 rounded-md ${activeIncidents.length > 0 ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"}`}>
              <AlertCircle className="w-5 h-5" />
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-slate-900 border-slate-800">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-slate-400">Degraded Providers</p>
              <h3 className="text-2xl font-semibold text-slate-100 mt-1">{degradedProviders.length}</h3>
            </div>
            <div className={`p-2 rounded-md ${degradedProviders.length > 0 ? "bg-amber-500/10 text-amber-400" : "bg-emerald-500/10 text-emerald-400"}`}>
              <Activity className="w-5 h-5" />
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-slate-900 border-slate-800">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-slate-400">Security Flags</p>
              <h3 className="text-2xl font-semibold text-slate-100 mt-1">3</h3>
            </div>
            <div className="p-2 bg-amber-500/10 text-amber-400 rounded-md">
              <Shield className="w-5 h-5" />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-lg font-medium text-slate-200">Attention Queue</h2>
          <AdminAttentionQueue />
        </div>
        <div className="space-y-4">
          <h2 className="text-lg font-medium text-slate-200">Quick Actions</h2>
          <Card className="bg-slate-900 border-slate-800 overflow-hidden">
            <div className="divide-y divide-slate-800">
              <Link to="/app/admin/providers" className="flex items-center gap-3 p-4 hover:bg-slate-800/50 transition-colors">
                <Activity className="w-5 h-5 text-slate-400" />
                <div>
                  <h4 className="text-sm font-medium text-slate-200">Manage Providers</h4>
                  <p className="text-xs text-slate-500">Route traffic away from degraded models</p>
                </div>
              </Link>
              <Link to="/app/admin/tenants" className="flex items-center gap-3 p-4 hover:bg-slate-800/50 transition-colors">
                <Building2 className="w-5 h-5 text-slate-400" />
                <div>
                  <h4 className="text-sm font-medium text-slate-200">Tenant Lookup</h4>
                  <p className="text-xs text-slate-500">Search and investigate workspace issues</p>
                </div>
              </Link>
              <Link to="/app/admin/security" className="flex items-center gap-3 p-4 hover:bg-slate-800/50 transition-colors">
                <Shield className="w-5 h-5 text-slate-400" />
                <div>
                  <h4 className="text-sm font-medium text-slate-200">Security Review</h4>
                  <p className="text-xs text-slate-500">Review suspicious sign-ins and abuse</p>
                </div>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
