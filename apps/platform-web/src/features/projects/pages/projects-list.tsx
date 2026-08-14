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
import { Briefcase, MoreHorizontal } from "lucide-react"
import { RequirePermission } from "@/features/permissions/components/require-permission"
import { formatDistanceToNow } from "date-fns"

export function ProjectsList() {
  const navigate = useNavigate()
  
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.projects.all,
    queryFn: () => api.getProjects(),
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Projects" description="Manage and build your AI solutions." />
        <LoadingState fullScreen />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Projects" description="Manage and build your AI solutions." />
        <ErrorState
          description="Failed to load projects."
          retryAction={<Button onClick={() => refetch()} variant="outline">Retry</Button>}
        />
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Projects" description="Manage and build your AI solutions." />
        <EmptyState
          icon={Briefcase}
          title="No projects yet"
          description="Create your first project to have AlterX build a solution."
          primaryAction={
            <RequirePermission permission="project.create">
              <Button onClick={() => navigate("/app/projects/new")}>Create project</Button>
            </RequirePermission>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Projects" 
        description="Manage and build your AI solutions."
        primaryAction={
          <RequirePermission permission="project.create">
            <Button onClick={() => navigate("/app/projects/new")}>Create project</Button>
          </RequirePermission>
        }
      />

      <div className="rounded-xl border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-[100px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((project) => (
              <TableRow key={project.id} className="ax-row-hover transition-all">
                <TableCell>
                  <div className="font-medium cursor-pointer hover:underline text-primary" onClick={() => navigate(`/app/projects/${project.id}`)}>
                    {project.name}
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={project.status as any} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => navigate(`/app/projects/${project.id}`)}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
