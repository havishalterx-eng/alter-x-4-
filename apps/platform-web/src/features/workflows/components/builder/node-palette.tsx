import * as React from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { type NodeTypeDefinition } from "@/api/types"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"

export function NodePalette() {
  const [search, setSearch] = React.useState("")
  const { data: nodeTypes } = useQuery({
    queryKey: queryKeys.nodeTypes.all,
    queryFn: () => api.getNodeTypes(),
  })

  const onDragStart = (event: React.DragEvent, nodeType: string, label: string, category: string) => {
    event.dataTransfer.setData("application/reactflow", nodeType)
    event.dataTransfer.setData("application/reactflow-label", label)
    event.dataTransfer.setData("application/reactflow-category", category)
    event.dataTransfer.effectAllowed = "move"
  }

  const filteredNodes = React.useMemo(() => {
    if (!nodeTypes) return []
    if (!search.trim()) return nodeTypes
    const lower = search.toLowerCase()
    return nodeTypes.filter(n => n.name.toLowerCase().includes(lower) || n.description.toLowerCase().includes(lower))
  }, [search, nodeTypes])

  const groupedNodes = React.useMemo(() => {
    const map = new Map<string, NodeTypeDefinition[]>()
    filteredNodes.forEach(n => {
      const arr = map.get(n.category) || []
      arr.push(n)
      map.set(n.category, arr)
    })
    return map
  }, [filteredNodes])

  return (
    <div className="flex h-full w-64 flex-col border-r border-border bg-surface">
      <div className="p-4 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search nodes..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {Array.from(groupedNodes.entries()).map(([category, nodes]) => (
          <div key={category} className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{category}</h4>
            <div className="space-y-2">
              {nodes.map(node => (
                <div
                  key={node.type}
                  draggable
                  onDragStart={(e) => onDragStart(e, node.type, node.name, node.category)}
                  className="cursor-grab rounded-lg border border-border bg-surface-raised p-3 shadow-sm transition-colors hover:border-primary/50 hover:bg-surface-hover"
                >
                  <p className="text-sm font-medium">{node.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{node.description}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
        {filteredNodes.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-8">
            No nodes found
          </div>
        )}
      </div>
    </div>
  )
}
