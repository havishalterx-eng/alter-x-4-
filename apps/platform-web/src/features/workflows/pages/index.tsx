import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusBadge } from "@/components/common/status-badge"
import { LoadingState } from "@/components/feedback/loading-state"
import { EmptyState } from "@/components/feedback/empty-state"
import { ErrorState } from "@/components/feedback/error-state"
import { Button } from "@/components/ui/button"
import { GitGraph, MoreHorizontal, PenTool, Play, Info, GitCommit } from "lucide-react"
import { RequirePermission } from "@/features/permissions/components/require-permission"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

export function WorkflowsList() {
  const navigate = useNavigate()
  
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.workflows.all,
    queryFn: () => api.getWorkflows(),
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Workflows" description="Build, manage and monitor automated workflows." />
        <LoadingState fullScreen />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Workflows" description="Build, manage and monitor automated workflows." />
        <ErrorState
          description="Failed to load workflows."
          retryAction={<Button onClick={() => refetch()} variant="outline">Retry</Button>}
        />
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Workflows" description="Build, manage and monitor automated workflows." />
        <EmptyState
          icon={GitGraph}
          title="No workflows yet"
          description="Create your first workflow to automate a process."
          primaryAction={
            <RequirePermission permission="workflow.create">
              <Button onClick={() => navigate("/app/workflows/new")}>Create workflow</Button>
            </RequirePermission>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Workflows" 
        description="Build, manage and monitor automated workflows."
        primaryAction={
          <RequirePermission permission="workflow.create">
            <Button onClick={() => navigate("/app/workflows/new")}>Create workflow</Button>
          </RequirePermission>
        }
      />

      <div className="rounded-xl border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Runs</TableHead>
              <TableHead className="text-right">Success Rate</TableHead>
              <TableHead className="w-[100px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((workflow) => (
              <TableRow key={workflow.id} className="ax-row-hover transition-all">
                <TableCell>
                  <div>
                    <div className="font-medium cursor-pointer hover:underline text-primary" onClick={() => navigate(`/app/workflows/${workflow.id}`)}>{workflow.name}</div>
                    {workflow.description && (
                      <div className="text-xs text-muted-foreground mt-1">{workflow.description}</div>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={workflow.status as any} />
                </TableCell>
                <TableCell className="text-right">{workflow.runs.toLocaleString()}</TableCell>
                <TableCell className="text-right">{workflow.successRate}%</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => navigate(`/app/workflows/${workflow.id}`)}>
                        <Info className="mr-2 h-4 w-4" />
                        Overview
                      </DropdownMenuItem>
                      <RequirePermission permission="workflow.update">
                        <DropdownMenuItem onClick={() => navigate(`/app/workflows/${workflow.id}/build`)}>
                          <PenTool className="mr-2 h-4 w-4" />
                          Edit Builder
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => navigate(`/app/workflows/${workflow.id}/versions`)}>
                          <GitCommit className="mr-2 h-4 w-4" />
                          Versions
                        </DropdownMenuItem>
                      </RequirePermission>
                      <RequirePermission permission="workflow.run">
                        <DropdownMenuItem onClick={() => navigate(`/app/workflows/${workflow.id}/simulation`)}>
                          <Play className="mr-2 h-4 w-4" />
                          Simulate
                        </DropdownMenuItem>
                      </RequirePermission>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
