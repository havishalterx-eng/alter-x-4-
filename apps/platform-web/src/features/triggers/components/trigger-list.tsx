import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Play, Webhook, Clock, Zap, Settings, CheckCircle2, AlertCircle, Mail, Loader2 } from "lucide-react"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface TriggerListProps {
  workflowId: string
}

export function TriggerList({ workflowId }: TriggerListProps) {
  const queryClient = useQueryClient()
  
  const { data: triggers, isLoading } = useQuery({
    queryKey: queryKeys.triggers.list(workflowId),
    queryFn: () => api.getTriggers(workflowId),
  })

  const toggleTrigger = useMutation({
    mutationFn: async ({ id, enable }: { id: string, enable: boolean }) => {
      return enable ? api.enableTrigger(id) : api.disableTrigger(id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.triggers.list(workflowId) })
    }
  })

  const testTrigger = useMutation({
    mutationFn: (id: string) => api.testTrigger(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.triggers.list(workflowId) })
      // Normally we'd show a toast here
      alert(data.success ? `Success: ${data.message}` : `Failed: ${data.message}`)
    }
  })

  if (isLoading) return <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>

  if (!triggers?.length) {
    return (
      <div className="text-center p-8 border border-border border-dashed rounded-xl bg-surface-base">
        <Zap className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-foreground">No triggers configured.</p>
        <p className="text-sm text-muted-foreground mt-1">Add a trigger to start this workflow automatically.</p>
        <Button variant="outline" className="mt-4">Add Trigger</Button>
      </div>
    )
  }

  const getIcon = (type: string) => {
    switch(type) {
      case "webhook": return <Webhook className="h-4 w-4" />
      case "schedule": return <Clock className="h-4 w-4" />
      case "email": return <Mail className="h-4 w-4" />
      default: return <Zap className="h-4 w-4" />
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Configured Triggers</h3>
        <Button variant="outline" size="sm">Add Trigger</Button>
      </div>

      <div className="grid gap-3">
        {triggers.map(t => (
          <div key={t.id} className="flex items-center justify-between p-4 rounded-xl border border-border bg-surface-base">
            <div className="flex items-center gap-4">
              <div className={cn(
                "h-10 w-10 shrink-0 rounded-lg flex items-center justify-center",
                t.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              )}>
                {getIcon(t.type)}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-medium text-sm">{t.name}</h4>
                  {t.status === "configured" && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                  {t.status === "needs_configuration" && <AlertCircle className="h-3 w-3 text-amber-500" />}
                  {t.status === "error" && <AlertCircle className="h-3 w-3 text-destructive" />}
                </div>
                <p className="text-xs text-muted-foreground capitalize mt-0.5">{t.type} Trigger</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => testTrigger.mutate(t.id)}
                disabled={testTrigger.isPending || t.status === "needs_configuration"}
              >
                <Play className="h-4 w-4 mr-2" />
                Test
              </Button>
              <Button variant="ghost" size="icon">
                <Settings className="h-4 w-4" />
              </Button>
              <Button 
                variant={t.enabled ? "primary" : "outline"}
                size="sm"
                onClick={() => toggleTrigger.mutate({ id: t.id, enable: !t.enabled })}
                disabled={t.status === "needs_configuration" || toggleTrigger.isPending}
              >
                {t.enabled ? "Enabled" : "Disabled"}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
