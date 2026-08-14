import { useQuery } from "@tanstack/react-query"
import { Webhook, Plus, ExternalLink, Settings, ShieldAlert, Loader2 } from "lucide-react"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { Button } from "@/components/ui/button"
import { Link } from "react-router-dom"

export function WebhooksPage() {
  const { data: webhooks, isLoading } = useQuery({
    queryKey: queryKeys.webhooks.list,
    queryFn: () => api.getWebhooks(),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-medium tracking-tight">Webhooks</h2>
          <p className="text-sm text-muted-foreground mt-1">Manage incoming webhook endpoints for your workflows.</p>
        </div>
        <Button variant="primary">
          <Plus className="mr-2 h-4 w-4" />
          Create Endpoint
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !webhooks?.length ? (
        <div className="text-center p-8 border border-border border-dashed rounded-xl bg-surface-base">
          <Webhook className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-foreground">No webhooks configured.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {webhooks.map((wh) => (
            <div key={wh.id} className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-xl border border-border bg-surface-base hover:border-primary/50 transition-colors">
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center text-primary mt-1">
                  <Webhook className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium text-foreground">{wh.name}</h3>
                    {wh.enabled ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        Disabled
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center font-mono bg-surface-raised px-1.5 py-0.5 rounded">
                      <span className="font-semibold text-foreground mr-1.5">{wh.method}</span>
                      {wh.path}
                    </span>
                    <span className="flex items-center">
                      <ShieldAlert className="mr-1 h-3 w-3" />
                      Auth: <span className="capitalize ml-1">{wh.authentication}</span>
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/app/workflows/${wh.workflowId}`}>
                    Workflow <ExternalLink className="ml-2 h-3 w-3" />
                  </Link>
                </Button>
                <Button variant="ghost" size="icon">
                  <Settings className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
