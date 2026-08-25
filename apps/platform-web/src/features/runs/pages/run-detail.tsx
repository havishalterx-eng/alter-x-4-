import * as React from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { formatDistanceToNow } from "date-fns"
import { ArrowLeft, Square, RefreshCcw, Clock, Activity } from "lucide-react"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StatusBadge } from "@/components/common/status-badge"
import { useRunStreamStore } from "../stores/useRunStreamStore"
import { RunTimeline } from "../components/run-timeline"
import { RunInspector } from "../components/run-inspector"
import { TerminalView } from "../components/terminal-view"
import { RunVector } from "@/components/vectors/RunVector"
import { toast } from "sonner"

export function RunDetail() {
  const { runId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  
  const { connect, disconnect, runStatus, connectionStatus, terminalLines, selectedNodeId, clear } = useRunStreamStore()

  const { data: run, isLoading } = useQuery({
    queryKey: queryKeys.runs.detail(runId!),
    queryFn: () => api.getRun(runId!),
    enabled: !!runId,
  })

  const stopRun = useMutation({
    mutationFn: () => api.stopRun(runId!),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.runs.detail(runId!) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.runs.all })
      toast.success("Run cancellation requested")
    },
    onError: () => toast.error("Unable to stop this run"),
  })

  const retryNode = useMutation({
    mutationFn: () => {
      if (!selectedNodeId) throw new Error("Select a failed node before retrying")
      return api.retryRun(runId!, selectedNodeId)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.runs.detail(runId!) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.runs.all })
      toast.success("Node retry requested")
    },
    onError: (error) => toast.error(error.message),
  })

  // Start live stream when component mounts
  React.useEffect(() => {
    if (runId) {
      clear()
      connect(runId)
    }
    return () => disconnect()
  }, [runId])

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Activity className="h-8 w-8 animate-pulse text-muted-foreground" />
      </div>
    )
  }

  if (!run) return null

  // Ensure runStatus reflects the live state from the stream store if available, or the API data.
  // We'll prefer the live status if we've received events.
  const displayStatus = (runStatus !== "queued" && runStatus) ? runStatus : run.status

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ax-border bg-ax-surface-0 p-4 shrink-0 relative">
        <div className="flex items-center gap-4 relative z-10">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold tracking-tight">Run <span className="font-mono text-primary text-lg">{run.id}</span></h1>
              <StatusBadge status={displayStatus as any} />
              {connectionStatus === "connected" && (
                <span className="flex items-center text-xs font-medium text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                  <span className="relative flex h-2 w-2 mr-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  Live
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
              <button 
                className="hover:text-foreground transition-colors"
                onClick={() => navigate(run.mode === "project" ? `/app/projects/${run.projectId}` : `/app/workflows/${run.workflowId}`)}
              >
                {run.workflowName || run.projectName}
              </button>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {run.startedAt ? formatDistanceToNow(new Date(run.startedAt), { addSuffix: true }) : "Not started"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 relative z-10">
          {(displayStatus === "running" || displayStatus === "waiting") && (
            <Button
              variant="outline"
              className="text-danger hover:text-danger hover:bg-danger/10 border-danger/20"
              onClick={() => stopRun.mutate()}
              disabled={stopRun.isPending}
            >
              <Square className="mr-2 h-4 w-4" />
              {stopRun.isPending ? "Stopping…" : "Stop Run"}
            </Button>
          )}
          {displayStatus === "failed" && (
            <Button variant="primary" onClick={() => retryNode.mutate()} disabled={retryNode.isPending}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              {retryNode.isPending ? "Retrying…" : "Retry Selected Node"}
            </Button>
          )}
        </div>
        
        {/* Decorative Vector */}
        <div className="hidden lg:block absolute right-32 top-2 w-[240px] h-12 opacity-80 pointer-events-none">
          <RunVector status={displayStatus as string} />
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0">
          <Tabs defaultValue="timeline" className="flex-1 flex flex-col">
            <div className="border-b border-border bg-surface px-6 pt-4 shrink-0">
              <TabsList>
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
                <TabsTrigger value="terminal">Terminal</TabsTrigger>
                <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
              </TabsList>
            </div>
            
            <div className="flex-1 overflow-hidden">
              <TabsContent value="timeline" className="h-full m-0">
                <div className="flex h-full">
                  <RunTimeline />
                  <RunInspector />
                </div>
              </TabsContent>
              
              <TabsContent value="terminal" className="h-full m-0 p-6">
                <TerminalView lines={terminalLines} className="h-full" />
              </TabsContent>
              
              <TabsContent value="artifacts" className="h-full m-0 p-6">
                <div className="text-muted-foreground text-center pt-12">
                  Artifacts will appear here as they are generated.
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
