import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { PageHeader } from "@/components/common/page-header"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { LoadingState } from "@/components/feedback/loading-state"
import { EmptyState } from "@/components/feedback/empty-state"
import { BarChart2, Plus } from "lucide-react"
import { RequirePermission } from "@/features/permissions/components/require-permission"
import { formatDistanceToNow } from "date-fns"

export function BenchmarkListPage() {
  const navigate = useNavigate()

  const { data: benchmarks = [], isLoading } = useQuery({
    queryKey: queryKeys.benchmarks.list,
    queryFn: () => api.benchmarks.list(),
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Benchmarks" description="Evaluate and compare workflow and project performance." />
        <LoadingState fullScreen />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader 
        title="Benchmarks" 
        description="Evaluate and compare workflow and project performance."
        primaryAction={
          <RequirePermission permission="benchmark.create">
            <Button onClick={() => navigate("/app/benchmarks/new")}>
              <Plus className="mr-2 h-4 w-4" />
              New Benchmark
            </Button>
          </RequirePermission>
        }
      />

      {benchmarks.length === 0 ? (
        <EmptyState
          icon={BarChart2}
          title="No benchmarks defined"
          description="Create your first benchmark to evaluate agent performance against known test sets."
          primaryAction={
            <RequirePermission permission="benchmark.create">
              <Button onClick={() => navigate("/app/benchmarks/new")}>
                Create Benchmark
              </Button>
            </RequirePermission>
          }
        />
      ) : (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Dataset</TableHead>
                <TableHead>Metrics</TableHead>
                <TableHead className="text-right">Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {benchmarks.map(benchmark => (
                <TableRow 
                  key={benchmark.id}
                  className="cursor-pointer hover:bg-surface-hover transition-colors"
                  onClick={() => navigate(`/app/benchmarks/${benchmark.id}`)}
                >
                  <TableCell>
                    <p className="font-medium text-text-primary">{benchmark.name}</p>
                    {benchmark.description && (
                      <p className="text-xs text-text-muted mt-1 truncate max-w-xs">{benchmark.description}</p>
                    )}
                  </TableCell>
                  <TableCell className="capitalize text-sm">
                    {benchmark.targetType.replace('_', ' ')}
                  </TableCell>
                  <TableCell className="text-sm">
                    {benchmark.datasetId ? "Dataset linked" : "None"}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap max-w-xs">
                      {benchmark.metrics.slice(0, 3).map(m => (
                        <span key={m.id} className="inline-flex rounded-full bg-surface-raised px-2 py-0.5 text-[10px] text-text-secondary border border-border">
                          {m.name}
                        </span>
                      ))}
                      {benchmark.metrics.length > 3 && (
                        <span className="inline-flex rounded-full bg-surface-raised px-2 py-0.5 text-[10px] text-text-secondary border border-border">
                          +{benchmark.metrics.length - 3}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-sm text-text-muted">
                    {formatDistanceToNow(new Date(benchmark.updatedAt), { addSuffix: true })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
