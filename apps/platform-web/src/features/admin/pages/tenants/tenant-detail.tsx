
import { useParams, Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"

import { Card } from "@/components/ui/card"
import { StatusBadge } from "@/components/common/status-badge"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Loader2, ArrowLeft, Users, Activity, AlertTriangle, Shield, CheckCircle2 } from "lucide-react"

export function TenantDetail() {
  const { tenantId } = useParams<{ tenantId: string }>()
  const queryClient = useQueryClient()
  
  const { data: tenant, isLoading } = useQuery({
    queryKey: queryKeys.admin.tenants.detail(tenantId!),
    queryFn: () => api.admin.tenants.get(tenantId!),
    enabled: !!tenantId
  })

  const { data: notes, isLoading: notesLoading } = useQuery({
    queryKey: queryKeys.admin.tenants.notes(tenantId!),
    queryFn: () => api.admin.tenants.getNotes(tenantId!),
    enabled: !!tenantId
  })

  const suspendMutation = useMutation({
    mutationFn: () => api.admin.tenants.suspend(tenantId!, "Admin intervention"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.tenants.detail(tenantId!) })
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.tenants.notes(tenantId!) })
    }
  })

  const restoreMutation = useMutation({
    mutationFn: () => api.admin.tenants.restore(tenantId!, "Admin intervention"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.tenants.detail(tenantId!) })
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.tenants.notes(tenantId!) })
    }
  })

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
      </div>
    )
  }

  if (!tenant) return <div className="p-8 text-slate-400">Tenant not found</div>

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <Link to="/app/admin/tenants" className="inline-flex items-center text-sm text-slate-400 hover:text-slate-200 transition-colors">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Tenants
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-3">
            {tenant.name}
            <StatusBadge status={tenant.status} />
            {tenant.riskState && tenant.riskState !== "normal" && (
              <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <AlertTriangle className="w-3 h-3 mr-1" />
                Risk: {tenant.riskState}
              </Badge>
            )}
          </h1>
          <p className="text-slate-400 mt-1">ID: {tenant.id} • Slug: {tenant.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          {tenant.status === "active" ? (
            <Button variant="danger" size="sm" onClick={() => suspendMutation.mutate()} disabled={suspendMutation.isPending}>
              {suspendMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Shield className="w-4 h-4 mr-2" />}
              Suspend Tenant
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => restoreMutation.mutate()} disabled={restoreMutation.isPending}>
              {restoreMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
              Restore Tenant
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 bg-slate-900 border-slate-800">
          <p className="text-sm text-slate-400">Plan</p>
          <p className="text-lg font-medium text-slate-200 capitalize mt-1">{tenant.plan}</p>
        </Card>
        <Card className="p-4 bg-slate-900 border-slate-800">
          <p className="text-sm text-slate-400 flex items-center gap-1"><Users className="w-4 h-4" /> Members</p>
          <p className="text-lg font-medium text-slate-200 mt-1">{tenant.memberCount}</p>
        </Card>
        <Card className="p-4 bg-slate-900 border-slate-800">
          <p className="text-sm text-slate-400 flex items-center gap-1"><Activity className="w-4 h-4" /> 30d Runs</p>
          <p className="text-lg font-medium text-slate-200 mt-1">{tenant.runCount30d.toLocaleString()}</p>
        </Card>
        <Card className="p-4 bg-slate-900 border-slate-800">
          <p className="text-sm text-slate-400">Current Spend</p>
          <p className="text-lg font-medium text-slate-200 mt-1">${tenant.currentSpend?.toFixed(2) || "0.00"}</p>
        </Card>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-medium text-slate-200">Admin Notes</h3>
        {notesLoading ? (
          <div className="p-4 text-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
        ) : notes?.length === 0 ? (
          <Card className="p-4 bg-slate-900/50 border-slate-800 border-dashed text-center text-slate-500">
            No administrative notes.
          </Card>
        ) : (
          <div className="space-y-3">
            {notes?.map(note => (
              <Card key={note.id} className="p-4 bg-slate-900 border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm text-slate-200">{note.author.name}</span>
                  <span className="text-xs text-slate-500">{new Date(note.createdAt).toLocaleString()}</span>
                </div>
                <p className="text-sm text-slate-300">{note.body}</p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
