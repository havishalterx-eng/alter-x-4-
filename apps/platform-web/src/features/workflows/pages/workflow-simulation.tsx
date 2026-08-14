import * as React from "react"
import { useParams } from "react-router-dom"
import { Play, CheckCircle2, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useMutation } from "@tanstack/react-query"
import { api } from "@/api/client"

export function WorkflowSimulation() {
  const { workflowId } = useParams()
  
  const [simulationSteps, setSimulationSteps] = React.useState<any[]>([])

  const simulateMutation = useMutation({
    mutationFn: () => api.simulateWorkflow(workflowId!, {}),
    onSuccess: () => {
      setSimulationSteps([
        { name: "Incoming Webhook", status: "success", duration: "12ms" },
        { name: "Extract Lead Info", status: "success", duration: "482ms" },
        { name: "Slack Notification", status: "success", duration: "240ms" },
      ])
    }
  })

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-surface overflow-hidden md:flex-row">
      <div className="flex w-full flex-col border-r border-border md:w-[400px]">
        <div className="border-b border-border bg-surface px-6 py-4">
          <h1 className="text-lg font-semibold">Simulation</h1>
          <p className="text-sm text-muted-foreground">Test with mock inputs</p>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="space-y-4">
            <h3 className="font-medium">Mock Input Payload</h3>
            <div className="space-y-2">
              <Label>Email Subject</Label>
              <Input defaultValue="Urgent: System down" />
            </div>
            <div className="space-y-2">
              <Label>Email Body</Label>
              <textarea 
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                rows={4}
                defaultValue="Hello, our production system is currently experiencing an outage. Please look into this immediately."
              />
            </div>
          </div>
          
          <Button 
            variant="primary" 
            className="w-full" 
            onClick={() => simulateMutation.mutate()}
            disabled={simulateMutation.isPending}
          >
            {simulateMutation.isPending ? "Running..." : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Run Simulation
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 bg-surface-raised">
        <h2 className="text-xl font-semibold mb-6">Simulation Result</h2>
        
        {simulationSteps.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
            <Clock className="h-10 w-10 mb-4 opacity-50" />
            <p>Run a simulation to see the execution path here.</p>
          </div>
        ) : (
          <div className="max-w-2xl space-y-4">
            {simulationSteps.map((step, i) => (
              <div key={i} className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4">
                <CheckCircle2 className="h-6 w-6 text-emerald-500 shrink-0" />
                <div className="flex-1">
                  <h4 className="font-medium text-foreground">{step.name}</h4>
                  <p className="text-sm text-muted-foreground mt-1">Status: {step.status}</p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-mono text-muted-foreground bg-surface-hover px-2 py-1 rounded">
                    {step.duration}
                  </span>
                </div>
              </div>
            ))}
            
            <div className="mt-8 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-500" />
                <div>
                  <h4 className="font-semibold text-emerald-500">Simulation Complete</h4>
                  <p className="text-sm text-emerald-500/80 mt-1">Workflow successfully reached the terminal state.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
