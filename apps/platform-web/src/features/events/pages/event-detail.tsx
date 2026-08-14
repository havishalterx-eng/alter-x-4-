import { useParams, Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Play, AlertCircle, FileJson, Workflow, Zap, GitCommit, Loader2 } from "lucide-react"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Button } from "@/components/ui/button"
import { EventVector } from "@/components/vectors/EventVector"

export function EventDetail() {
  const { eventId } = useParams<{ eventId: string }>()
  const queryClient = useQueryClient()
  
  const { data: event, isLoading } = useQuery({
    queryKey: queryKeys.events.detail(eventId!),
    queryFn: () => api.getEvent(eventId!),
    enabled: !!eventId,
  })

  const replayEvent = useMutation({
    mutationFn: () => api.replayEvent(eventId!),
    onSuccess: () => {
      // Typically show toast
      queryClient.invalidateQueries({ queryKey: queryKeys.events.list() })
      alert("Event replayed successfully.")
    }
  })

  if (isLoading) return <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
  if (!event) return <div className="p-8 text-center text-muted-foreground">Event not found.</div>

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 md:px-6 pt-4">
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link to="/app/events">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Events
          </Link>
        </Button>
        <div className="relative">
          <PageHeader 
            title={event.type}
            description={`Received ${new Date(event.receivedAt).toLocaleString()}`}
          >
            <Button 
              variant="outline" 
              onClick={() => replayEvent.mutate()} 
              disabled={replayEvent.isPending}
            >
              <Play className="mr-2 h-4 w-4" />
              Replay Event
            </Button>
          </PageHeader>
          <div className="hidden md:block absolute right-4 top-2 w-[300px] h-16 opacity-80 pointer-events-none">
            <EventVector />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          
          {/* Status Banner */}
          {event.status === "failed" && (
            <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-medium text-destructive">Event Processing Failed</h3>
                <p className="text-sm text-destructive/80 mt-1">{event.error?.message || "Unknown error occurred"}</p>
                {event.error?.code && <p className="text-xs font-mono text-destructive/60 mt-2">Code: {event.error.code}</p>}
              </div>
            </div>
          )}

          <div className="grid gap-6 md:grid-cols-2">
            
            {/* Routing Info */}
            <div className="rounded-xl border border-border bg-surface-base p-5 space-y-4">
              <h3 className="font-medium flex items-center gap-2"><GitCommit className="h-4 w-4" /> Routing Outcome</h3>
              <div className="space-y-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Status</span>
                  <span className="text-sm font-medium capitalize">{event.status}</span>
                </div>
                {event.workflowId && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Matched Workflow</span>
                    <Link to={`/app/workflows/${event.workflowId}`} className="text-sm font-medium text-primary hover:underline flex items-center gap-1.5">
                      <Workflow className="h-3 w-3" />
                      {event.workflowId}
                    </Link>
                  </div>
                )}
                {event.triggerId && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Matched Trigger</span>
                    <span className="text-sm font-medium flex items-center gap-1.5">
                      <Zap className="h-3 w-3 text-muted-foreground" />
                      {event.triggerId}
                    </span>
                  </div>
                )}
                {event.runId && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Triggered Run</span>
                    <Link to={`/app/runs/${event.runId}`} className="text-sm font-medium text-primary hover:underline flex items-center gap-1.5">
                      <Play className="h-3 w-3" />
                      {event.runId}
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {/* Payload preview - mocking it if payloadRef is undefined */}
            <div className="rounded-xl border border-border bg-surface-base p-5">
              <h3 className="font-medium flex items-center gap-2 mb-4"><FileJson className="h-4 w-4" /> Event Payload</h3>
              <div className="bg-surface-raised rounded-lg p-3 overflow-auto max-h-[300px]">
                <pre className="text-xs text-muted-foreground">
                  {JSON.stringify({ headers: { "content-type": "application/json" }, body: { mockData: "This is a mock payload" } }, null, 2)}
                </pre>
              </div>
            </div>
            
          </div>
        </div>
      </div>
    </div>
  )
}
