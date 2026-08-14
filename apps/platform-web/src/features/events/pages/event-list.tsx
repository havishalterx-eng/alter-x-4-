import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Inbox, Filter, Clock, Activity, AlertCircle, ShieldCheck, Mail, Webhook, Zap, HelpCircle, Loader2 } from "lucide-react"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Button } from "@/components/ui/button"

export function EventList() {
  const navigate = useNavigate()
  
  const { data: events, isLoading } = useQuery({
    queryKey: queryKeys.events.list(),
    queryFn: () => api.getEvents(),
  })

  const getSourceIcon = (source: string) => {
    switch(source) {
      case "webhook": return <Webhook className="h-4 w-4" />
      case "schedule": return <Clock className="h-4 w-4" />
      case "email": return <Mail className="h-4 w-4" />
      case "integration": return <Zap className="h-4 w-4" />
      default: return <HelpCircle className="h-4 w-4" />
    }
  }

  const getStatusBadge = (status: string) => {
    switch(status) {
      case "triggered": return <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500"><ShieldCheck className="mr-1 h-3 w-3" /> Triggered</span>
      case "ignored": return <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Ignored</span>
      case "failed": return <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"><AlertCircle className="mr-1 h-3 w-3" /> Failed</span>
      default: return <span className="inline-flex items-center rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary"><Activity className="mr-1 h-3 w-3" /> {status}</span>
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader 
        title="Event Inbox" 
        description="All incoming events across the platform."
      >
        <Button variant="outline" size="sm">
          <Filter className="mr-2 h-4 w-4" />
          Filter
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-5xl space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : !events?.length ? (
            <div className="text-center p-8 border border-border border-dashed rounded-xl bg-surface-base">
              <Inbox className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-foreground">No events received.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-surface-base overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-surface-raised text-xs text-muted-foreground uppercase border-b border-border">
                  <tr>
                    <th className="px-4 py-3 font-medium">Event Type</th>
                    <th className="px-4 py-3 font-medium">Source</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Received</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {events.map((evt) => (
                    <tr 
                      key={evt.id}
                      onClick={() => navigate(`/app/events/${evt.id}`)}
                      className="hover:bg-surface-raised cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">{evt.type}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          {getSourceIcon(evt.source)}
                          <span className="capitalize">{evt.source}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">{getStatusBadge(evt.status)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {new Date(evt.receivedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
