import * as React from "react"
import { 
  ReactFlow, 
  Background, 
  Controls, 
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { BaseNode } from "./base-node"
import { useBuilderStore } from "../../stores/useBuilderStore"
import dagre from "@dagrejs/dagre"

// Keys are the engine's 11 canonical node types (node-type-catalog.ts) --
// every one renders the same generic BaseNode, differentiated only by
// data.category/data.label.
const nodeTypes = {
  LLMTask: BaseNode,
  ToolCall: BaseNode,
  SandboxExec: BaseNode,
  Gate: BaseNode,
  HumanApproval: BaseNode,
  Merge: BaseNode,
  Synthesis: BaseNode,
  MemoryWrite: BaseNode,
  PubSub: BaseNode,
  GroupChat: BaseNode,
  YAMLImport: BaseNode,
}

// Dagre Layout
const getLayoutedElements = (nodes: any[], edges: any[], direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  
  const nodeWidth = 200
  const nodeHeight = 80

  dagreGraph.setGraph({ rankdir: direction })

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight })
  })

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  dagre.layout(dagreGraph)

  nodes.forEach((node) => {
    const nodeWithPosition = dagreGraph.node(node.id)
    node.targetPosition = direction === 'LR' ? 'left' : 'top'
    node.sourcePosition = direction === 'LR' ? 'right' : 'bottom'

    node.position = {
      x: nodeWithPosition.x - nodeWidth / 2,
      y: nodeWithPosition.y - nodeHeight / 2,
    }
    return node
  })

  return { nodes, edges }
}

function CanvasCore({ readOnly }: { readOnly?: boolean }) {
  const { 
    nodes, edges, 
    onNodesChange, onEdgesChange, onConnect,
    setNodes, setEdges
  } = useBuilderStore()

  const { screenToFlowPosition } = useReactFlow()
  const wrapperRef = React.useRef<HTMLDivElement>(null)

  const onDragOver = React.useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }, [])

  const onDrop = React.useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      if (readOnly) return

      const type = event.dataTransfer.getData("application/reactflow")
      const label = event.dataTransfer.getData("application/reactflow-label")
      const category = event.dataTransfer.getData("application/reactflow-category")

      if (typeof type === "undefined" || !type) {
        return
      }

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })
      
      const newNode = {
        id: `node_${Date.now()}`,
        type,
        position,
        data: { label, category },
      }

      setNodes(nodes.concat(newNode))
    },
    [screenToFlowPosition, nodes, setNodes, readOnly]
  )

  // Expose auto layout function to window so toolbar can call it easily (mock implementation approach)
  React.useEffect(() => {
    ;(window as any).applyAutoLayout = () => {
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements([...nodes], [...edges])
      setNodes([...layoutedNodes])
      setEdges([...layoutedEdges])
    }
    return () => { delete (window as any).applyAutoLayout }
  }, [nodes, edges, setNodes, setEdges])

  return (
    <div className="flex-1 h-full w-full bg-surface-raised" ref={wrapperRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={readOnly ? undefined : onNodesChange}
        onEdgesChange={readOnly ? undefined : onEdgesChange}
        onConnect={readOnly ? undefined : onConnect}
        nodeTypes={nodeTypes}
        onDragOver={onDragOver}
        onDrop={onDrop}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable={true}
      >
        <Background />
        <Controls />
        <MiniMap zoomable pannable className="bg-surface border-border rounded-lg" />
      </ReactFlow>
    </div>
  )
}

export function WorkflowCanvas({ readOnly }: { readOnly?: boolean }) {
  return (
    <ReactFlowProvider>
      <CanvasCore readOnly={readOnly} />
    </ReactFlowProvider>
  )
}
