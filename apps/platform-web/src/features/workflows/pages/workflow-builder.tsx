import * as React from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useQuery, useMutation } from "@tanstack/react-query"
import { Save, Play, LayoutTemplate, PanelRight, ChevronLeft } from "lucide-react"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { WorkflowCanvas } from "../components/builder/canvas"
import { NodePalette } from "../components/builder/node-palette"
import { Inspector } from "../components/builder/inspector"
import { ValidationPanel } from "../components/builder/validation-panel"
import { useBuilderStore } from "../stores/useBuilderStore"

export function WorkflowBuilder() {
  const { workflowId } = useParams()
  const navigate = useNavigate()
  
  const { setWorkflowId, setNodes, setEdges, isDirty, setDirty, inspectorOpen, setInspectorOpen } = useBuilderStore()
  
  React.useEffect(() => {
    if (workflowId) setWorkflowId(workflowId)
  }, [workflowId, setWorkflowId])

  const { data: workflow, isLoading } = useQuery({
    queryKey: queryKeys.workflows.detail(workflowId!),
    queryFn: () => api.getWorkflow(workflowId!),
    enabled: !!workflowId,
  })

  // Mock initial setup for canvas
  React.useEffect(() => {
    if (workflow && !isDirty) {
      // Setup some mock nodes based on scenario
      const mockNodes = [
        { id: "1", type: "trigger_webhook", position: { x: 250, y: 50 }, data: { label: "Incoming Webhook", category: "Triggers" } },
        { id: "2", type: "ai_extract", position: { x: 250, y: 200 }, data: { label: "Extract Lead Info", category: "AI" } },
        { id: "3", type: "action_slack", position: { x: 250, y: 350 }, data: { label: "Slack Notification", category: "Actions" } }
      ]
      const mockEdges = [
        { id: "e1-2", source: "1", target: "2" },
        { id: "e2-3", source: "2", target: "3" }
      ]
      setNodes(mockNodes)
      setEdges(mockEdges)
      setDirty(false)
    }
  }, [workflow, setNodes, setEdges, setDirty])

  const saveMutation = useMutation({
    mutationFn: () => api.saveWorkflowGraph(workflowId!, { nodes: [], edges: [] }),
    onSuccess: () => {
      setDirty(false)
      toast.success("Workflow saved")
    }
  })

  const handleAutoLayout = () => {
    if ((window as any).applyAutoLayout) {
      (window as any).applyAutoLayout()
    }
  }

  if (isLoading) return null

  return (
    <div className="flex h-screen flex-col bg-surface overflow-hidden">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/app/workflows/${workflowId}`)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-sm font-semibold">{workflow?.name || "Workflow Builder"}</h1>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{isDirty ? "Unsaved changes" : "Saved"}</span>
              <span className="text-xs text-muted-foreground">•</span>
              <span className="text-xs text-muted-foreground capitalize">{workflow?.status}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleAutoLayout}>
            <LayoutTemplate className="mr-2 h-4 w-4" />
            Auto layout
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setInspectorOpen(!inspectorOpen)} className={inspectorOpen ? "bg-surface-hover" : ""}>
            <PanelRight className="mr-2 h-4 w-4" />
            Inspector
          </Button>
          <div className="h-4 w-px bg-border mx-2" />
          {/* Save is force-disabled: this mutation currently sends { nodes: [], edges: [] }
              instead of the real canvas state, which wipes the stored workflow on every
              click. Re-enable once saveMutation writes the actual builder-store graph. */}
          <Button variant="outline" size="sm" onClick={() => saveMutation.mutate()} disabled title="Save is temporarily disabled — reconnecting to real workflow data">
            <Save className="mr-2 h-4 w-4" />
            Save
          </Button>
          <Button variant="primary" size="sm" onClick={() => navigate(`/app/workflows/${workflowId}/simulation`)}>
            <Play className="mr-2 h-4 w-4" />
            Simulate
          </Button>
        </div>
      </header>

      {/* Main Builder Area */}
      <div className="flex flex-1 overflow-hidden">
        <NodePalette />
        <div className="relative flex-1">
          <WorkflowCanvas />
          <ValidationPanel />
        </div>
        {inspectorOpen && <Inspector />}
      </div>
    </div>
  )
}
