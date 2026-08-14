import { useQuery } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Shield, LifeBuoy, Store, BadgeDollarSign, ArrowRight, Loader2 } from "lucide-react"
import { Link } from "react-router-dom"

export function AdminAttentionQueue() {
  const { data: support, isLoading: loadingSupport } = useQuery({
    queryKey: queryKeys.admin.support.requests,
    queryFn: () => api.admin.support.list()
  })

  const { data: security, isLoading: loadingSecurity } = useQuery({
    queryKey: queryKeys.admin.security.list,
    queryFn: () => api.admin.security.list()
  })

  const { data: marketplace, isLoading: loadingMarketplace } = useQuery({
    queryKey: queryKeys.admin.marketplace.reviewQueue,
    queryFn: () => api.admin.marketplace.reviewQueue()
  })

  const { data: billing, isLoading: loadingBilling } = useQuery({
    queryKey: queryKeys.admin.billing.issues,
    queryFn: () => api.admin.billing.listIssues()
  })

  const isLoading = loadingSupport || loadingSecurity || loadingMarketplace || loadingBilling

  if (isLoading) {
    return (
      <Card className="p-8 flex items-center justify-center bg-slate-900 border-slate-800">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </Card>
    )
  }

  const items = [
    ...(support?.filter(r => r.status === "pending").map(r => ({
      id: r.id,
      type: "support" as const,
      title: "Support Access Request",
      summary: `Requested by ${r.requestedBy.name} for ${r.reason}`,
      link: `/app/admin/support`,
      icon: LifeBuoy,
      color: "text-primary",
      bg: "bg-primary-soft",
      date: r.requestedAt
    })) || []),
    ...(security?.filter(s => s.status === "open").map(s => ({
      id: s.id,
      type: "security" as const,
      title: s.title,
      summary: s.summary,
      link: `/app/admin/security`,
      icon: Shield,
      color: s.severity === "critical" ? "text-red-400" : "text-amber-400",
      bg: s.severity === "critical" ? "bg-red-500/10" : "bg-amber-500/10",
      date: s.createdAt
    })) || []),
    ...(marketplace?.filter(m => m.status === "pending_review").map(m => ({
      id: m.id,
      type: "marketplace" as const,
      title: "Marketplace Listing Review",
      summary: `${m.listingName} by ${m.sellerName}`,
      link: `/app/admin/marketplace`,
      icon: Store,
      color: "text-primary",
      bg: "bg-primary-soft",
      date: m.submittedAt
    })) || []),
    ...(billing?.filter(b => b.status === "open").map(b => ({
      id: b.id,
      type: "billing" as const,
      title: "Billing Issue",
      summary: `${b.tenantName}: ${b.issue.replace("_", " ")}`,
      link: `/app/admin/billing`,
      icon: BadgeDollarSign,
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      date: b.createdAt
    })) || []),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  if (items.length === 0) {
    return (
      <Card className="p-12 flex flex-col items-center justify-center text-center bg-slate-900 border-slate-800">
        <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
          <Shield className="w-6 h-6 text-emerald-400" />
        </div>
        <h3 className="text-lg font-medium text-slate-200">Queue Empty</h3>
        <p className="text-slate-400 mt-1 max-w-sm">No items require immediate attention. Platform operations are running smoothly.</p>
      </Card>
    )
  }

  return (
    <Card className="bg-slate-900 border-slate-800 divide-y divide-slate-800 overflow-hidden">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <div key={`${item.type}-${item.id}`} className="p-4 flex items-center gap-4 hover:bg-slate-800/30 transition-colors group">
            <div className={`p-2 rounded-md ${item.bg} ${item.color} flex-shrink-0`}>
              <Icon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium text-slate-200 truncate">{item.title}</h4>
                <Badge variant="outline" className="text-[10px] uppercase tracking-wider">{item.type}</Badge>
              </div>
              <p className="text-sm text-slate-400 truncate mt-1">{item.summary}</p>
            </div>
            <div className="flex-shrink-0">
              <Button variant="ghost" size="sm" asChild className="opacity-0 group-hover:opacity-100 transition-opacity">
                <Link to={item.link}>
                  Review <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </div>
          </div>
        )
      })}
    </Card>
  )
}
