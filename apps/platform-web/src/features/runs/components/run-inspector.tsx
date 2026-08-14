import { useRunStreamStore } from "../stores/useRunStreamStore"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { X, RefreshCcw, AlertTriangle, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { Badge } from "@/components/ui/badge"
import { ShieldCheck, ServerCrash, RotateCcw, FastForward, Play, Database, Key } from "lucide-react"
import { useState } from "react"
import { Input } from "@/components/ui/input"

export function RunInspector() {
  const { nodeExecutions, selectedNodeId, setSelectedNodeId } = useRunStreamStore()

  if (!selectedNodeId || !nodeExecutions[selectedNodeId]) {
    return (
      <div className="flex h-full w-[400px] flex-col border-l border-border bg-surface items-center justify-center p-6 text-center text-muted-foreground">
        <p className="text-sm">Select a node in the timeline to view details.</p>
      </div>
    )
  }

  const node = nodeExecutions[selectedNodeId]

  return (
    <div className="flex h-full w-[400px] flex-col border-l border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border p-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{node.nodeName}</h3>
            {node.status === "completed" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
            {node.status === "failed" && <AlertTriangle className="h-4 w-4 text-destructive" />}
            {node.status === "running" && <RefreshCcw className="h-4 w-4 text-primary animate-spin" />}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Attempt {node.attempt}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setSelectedNodeId(undefined)}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        <Tabs defaultValue="overview" className="flex-1 flex flex-col w-full h-full">
          <div className="px-4 pt-4">
            <TabsList className="w-full">
              <TabsTrigger value="overview" className="flex-1">Overview</TabsTrigger>
              <TabsTrigger value="input" className="flex-1">Input</TabsTrigger>
              <TabsTrigger value="output" className="flex-1">Output</TabsTrigger>
              <TabsTrigger value="verification" className="flex-1">Verify</TabsTrigger>
            </TabsList>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4">
            <TabsContent value="overview" className="mt-0 space-y-6">
              <div className="space-y-3">
                <h4 className="text-sm font-medium">Timing & Cost</h4>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground block mb-1">Started</span>
                    <span className="font-mono">{node.startedAt ? new Date(node.startedAt).toLocaleTimeString() : "-"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Duration</span>
                    <span className="font-mono">{node.durationMs ? `${(node.durationMs / 1000).toFixed(2)}s` : "-"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Cost</span>
                    <span className="font-mono">{node.metadata?.cost !== undefined ? `$${node.metadata.cost}` : "-"}</span>
                  </div>
                </div>
              </div>

              {node.error && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-destructive">Error</h4>
                  {(node.error as any).code === "CONNECTION_DEGRADED" && (
                    <div className="p-3 bg-warning/10 text-warning border border-warning/20 rounded-lg text-sm mb-2 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      Connection Degraded: Required credentials may be expired or invalid.
                    </div>
                  )}
                  {String(node.error.message).includes("CREDENTIAL_MISSING") && (
                    <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg space-y-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-primary">
                        <Key className="h-4 w-4" />
                        Credential Required
                      </div>
                      <p className="text-xs text-muted-foreground">
                        This node requires a credential to proceed. Please provide the secret value to resume execution.
                      </p>
                      <CredentialResumeForm runId={node.runId} nodeId={node.nodeId} />
                    </div>
                  )}
                  <div className="bg-destructive/10 p-3 rounded-lg border border-destructive/20 text-sm text-destructive font-mono break-all">
                    {node.error.message}
                  </div>
                  <Button variant="outline" size="sm" className="w-full">View Logs</Button>
                </div>
              )}

              {Boolean(node.metadata?.modelOutput) && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">Live Output</h4>
                  <div className="bg-surface-raised p-3 rounded-lg border border-border text-sm text-muted-foreground whitespace-pre-wrap">
                    {String(node.metadata?.modelOutput || "")}
                    {node.status === "running" && <span className="animate-pulse ml-1">▋</span>}
                  </div>
                  {Boolean(node.metadata?.provenance) && Array.isArray(node.metadata?.provenance) && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {((node.metadata?.provenance || []) as any[]).map((prov: any, idx: number) => (
                        <Badge key={idx} variant="secondary" className="text-xs font-normal bg-muted">
                          <Database className="h-3 w-3 mr-1" />
                          {prov.sourceName} / {prov.documentName}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {(node.status === "failed" || node.status === "waiting") && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">Recovery Actions</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" className="w-full justify-start text-xs">
                      <RotateCcw className="mr-2 h-3 w-3" /> Retry Node
                    </Button>
                    <Button variant="outline" size="sm" className="w-full justify-start text-xs">
                      <FastForward className="mr-2 h-3 w-3" /> Skip Node
                    </Button>
                    <Button variant="outline" size="sm" className="w-full justify-start text-xs">
                      <Play className="mr-2 h-3 w-3" /> Force Resume
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="input" className="mt-0 space-y-4">
              <div className="text-sm text-muted-foreground text-center pt-8">
                Input references not available for mock.
              </div>
            </TabsContent>

            <TabsContent value="output" className="mt-0 space-y-4">
              <div className="text-sm text-muted-foreground text-center pt-8">
                Output references not available for mock.
              </div>
            </TabsContent>

            <TabsContent value="verification" className="mt-0 space-y-4">
              <NodeVerificationContent runId={node.runId} nodeId={node.nodeId} />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  )
}

function NodeVerificationContent({ runId, nodeId }: { runId: string, nodeId: string }) {
  const { data: verification, isLoading, isError } = useQuery({
    queryKey: queryKeys.verifications.node(runId, nodeId),
    queryFn: () => (api as any).getNodeVerification(runId, nodeId)
  })

  if (isLoading) {
    return <div className="space-y-3 animate-pulse pt-2">
      <div className="h-20 bg-surface-hover rounded-lg"></div>
      <div className="h-10 bg-surface-hover rounded-lg"></div>
    </div>
  }

  if (isError || !verification) {
    return <div className="text-sm text-text-muted pt-4 text-center">Verification not available</div>
  }

  const isHealthy = verification.status === "passed"
  
  return (
    <div className="space-y-4 pt-2">
      <div className={`p-4 rounded-lg border ${isHealthy ? 'bg-success/5 border-success/20' : 'bg-warning/5 border-warning/20'}`}>
        <div className="flex items-start gap-3">
          {isHealthy ? <ShieldCheck className="h-5 w-5 text-success" /> : <ServerCrash className="h-5 w-5 text-warning" />}
          <div>
            <h4 className="font-semibold text-sm">{verification.summary || "Verification Result"}</h4>
            <div className="mt-1 flex items-center gap-2">
              <Badge variant={isHealthy ? "success" : "warning"}>{verification.status}</Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">Checks</h4>
        {verification.checks.map((check: any) => (
          <div key={check.id} className="p-3 rounded-lg border border-border bg-surface-hover flex items-center justify-between text-sm">
            <span className="font-medium">{check.name}</span>
            <div className="flex items-center gap-2 text-xs">
              {check.message && <span className="text-text-muted">{check.message}</span>}
              <Badge variant={check.status === "passed" ? "success" : check.status === "warning" ? "warning" : "danger"}>
                {check.status}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CredentialResumeForm({ runId, nodeId }: { runId: string, nodeId: string }) {
  const [secret, setSecret] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!secret.trim()) return

    setLoading(true)
    setError(null)
    
    try {
      const res = await fetch(`/api/v1/runs/${runId}/nodes/${nodeId}/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connector: "generic", value: secret })
      })
      if (!res.ok) {
        throw new Error("Failed to submit credential")
      }
      setSecret("")
    } catch (err: any) {
      setError(err.message || "An error occurred")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        type="password"
        placeholder="Enter secret..."
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        className="flex-1 h-8 text-xs"
        disabled={loading}
      />
      <Button type="submit" size="sm" className="h-8 text-xs" disabled={loading || !secret.trim()}>
        {loading ? "Saving..." : "Resume"}
      </Button>
      {error && <div className="text-destructive text-xs w-full mt-1">{error}</div>}
    </form>
  )
}
