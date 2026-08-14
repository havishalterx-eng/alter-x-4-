import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { formatDistanceToNow } from "date-fns"
import { Search, Filter, Box, Network } from "lucide-react"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/common/status-badge"

function formatDuration(ms?: number) {
  if (!ms) return "-"
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.floor(s % 60)}s`
}

export function RunsList() {
  const navigate = useNavigate()
  const { data: runs = [], isLoading } = useQuery({
    queryKey: queryKeys.runs.all,
    queryFn: () => api.getRuns(),
  })
  
  const [search, setSearch] = React.useState("")

  const filtered = runs.filter(r => 
    (r.workflowName || r.projectName || "").toLowerCase().includes(search.toLowerCase()) ||
    r.id.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex-1 space-y-8 p-8 max-w-7xl mx-auto w-full">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Runs</h1>
          <p className="text-muted-foreground mt-1">Monitor workflow and project execution.</p>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search runs by ID or name..." 
            className="pl-9 bg-surface-raised border-border"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline">
          <Filter className="mr-2 h-4 w-4" />
          Filters
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-surface-raised overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-muted-foreground bg-surface-hover/50 uppercase border-b border-border">
            <tr>
              <th className="px-6 py-4 font-medium">Run</th>
              <th className="px-6 py-4 font-medium">Source</th>
              <th className="px-6 py-4 font-medium">Type</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium">Started</th>
              <th className="px-6 py-4 font-medium">Duration</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">Loading runs...</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">No runs found.</td>
              </tr>
            ) : (
              filtered.map((run) => (
                <tr 
                  key={run.id} 
                  className="border-b border-border last:border-0 hover:bg-surface-hover/30 transition-colors cursor-pointer"
                  onClick={() => navigate(run.mode === "project" ? `/app/projects/${run.projectId}/build` : `/app/runs/${run.id}`)}
                >
                  <td className="px-6 py-4">
                    <span className="font-mono text-xs text-primary">{run.id}</span>
                  </td>
                  <td className="px-6 py-4 font-medium">{run.workflowName || run.projectName}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      {run.mode === "project" ? <Box className="h-4 w-4" /> : <Network className="h-4 w-4" />}
                      <span className="capitalize">{run.mode || "Workflow"}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={run.status as any} />
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {run.startedAt ? formatDistanceToNow(new Date(run.startedAt), { addSuffix: true }) : "-"}
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {formatDuration(run.durationMs)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate(run.mode === "project" ? `/app/projects/${run.projectId}/build` : `/app/runs/${run.id}`)
                      }}
                    >
                      View
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
