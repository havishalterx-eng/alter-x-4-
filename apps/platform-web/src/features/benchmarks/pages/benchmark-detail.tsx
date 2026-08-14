import { useState } from "react"
import { useParams, Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { PageHeader } from "@/components/common/page-header"
import { Button } from "@/components/ui/button"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { LoadingState } from "@/components/feedback/loading-state"
import { ArrowLeft, Play, BarChart2, GitCommit, CheckCircle2, XCircle, Clock } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import type { BenchmarkResult } from "@/api/types"
import { formatCurrency } from "@/lib/utils"

export function BenchmarkDetailPage() {
  const { benchmarkId } = useParams<{ benchmarkId: string }>()
  const queryClient = useQueryClient()
  const [compareMode, setCompareMode] = useState(false)

  const { data: benchmark, isLoading: isLoadingBm } = useQuery({
    queryKey: queryKeys.benchmarks.detail(benchmarkId!),
    queryFn: () => api.benchmarks.get(benchmarkId!),
    enabled: !!benchmarkId
  })

  const { data: results = [], isLoading: isLoadingRes } = useQuery({
    queryKey: queryKeys.benchmarks.results(benchmarkId!),
    queryFn: () => api.benchmarks.getResults(benchmarkId!),
    enabled: !!benchmarkId
  })

  const { data: datasets = [] } = useQuery({
    queryKey: ["benchmarkDatasets"],
    queryFn: () => api.benchmarks.getDatasets(),
  })

  const runBenchmark = useMutation({
    mutationFn: () => api.benchmarks.run(benchmarkId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.benchmarks.results(benchmarkId!) })
    }
  })

  if (isLoadingBm || isLoadingRes) {
    return (
      <div className="space-y-6">
        <PageHeader title="Benchmark Detail" />
        <LoadingState fullScreen />
      </div>
    )
  }

  if (!benchmark) return <div>Benchmark not found</div>

  const dataset = datasets.find(d => d.id === benchmark.datasetId)
  const latestResult = results[0]
  const previousResult = results[1]

  const formatMetricValue = (metricId: string, value: number) => {
    const def = benchmark.metrics.find(m => m.id === metricId)
    if (!def) return value.toString()
    
    switch (def.type) {
      case "accuracy":
      case "success_rate":
      case "verification_rate":
        return `${value.toFixed(1)}%`
      case "latency":
        return `${value.toFixed(2)}s`
      case "cost":
        return formatCurrency(value, "USD")
      default:
        return value.toString()
    }
  }

  const renderComparison = (latest: BenchmarkResult, prev: BenchmarkResult) => {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        {benchmark.metrics.map(metric => {
          const latestVal = latest.metrics.find(m => m.metricId === metric.id)?.value || 0
          const prevVal = prev.metrics.find(m => m.metricId === metric.id)?.value || 0
          const diff = latestVal - prevVal
          
          let isBetter = false
          if (metric.higherIsBetter && diff > 0) isBetter = true
          if (!metric.higherIsBetter && diff < 0) isBetter = true
          
          const isSame = diff === 0

          return (
            <div key={metric.id} className="rounded-xl border border-border bg-surface p-4">
              <h4 className="text-sm font-medium text-text-secondary mb-3">{metric.name}</h4>
              <div className="flex justify-between items-end mb-2">
                <span className="text-xs text-text-muted">{prev.version}</span>
                <span className="text-lg font-semibold">{formatMetricValue(metric.id, prevVal)}</span>
              </div>
              <div className="flex justify-between items-end mb-3 pb-3 border-b border-border/50">
                <span className="text-xs text-text-muted">{latest.version || "Latest"}</span>
                <span className="text-lg font-semibold">{formatMetricValue(metric.id, latestVal)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-text-muted">Change</span>
                <span className={`text-xs font-semibold ${isSame ? "text-text-muted" : isBetter ? "text-success" : "text-danger"}`}>
                  {diff > 0 ? "+" : ""}{formatMetricValue(metric.id, diff)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
          <Link to="/app/benchmarks">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Benchmarks
          </Link>
        </Button>
        <PageHeader 
          title={benchmark.name}
          description={benchmark.description}
        >
          <div className="flex gap-2">
            {results.length > 1 && (
              <Button variant="outline" onClick={() => setCompareMode(!compareMode)}>
                {compareMode ? "Hide Comparison" : "Compare Versions"}
              </Button>
            )}
            <Button onClick={() => runBenchmark.mutate()} loading={runBenchmark.isPending}>
              <Play className="mr-2 h-4 w-4" />
              Run Evaluation
            </Button>
          </div>
        </PageHeader>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
          <h3 className="font-semibold text-text-primary flex items-center gap-2">
            <BarChart2 className="h-4 w-4" />
            Configuration
          </h3>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-text-muted">Target Type</p>
              <p className="text-sm capitalize">{benchmark.targetType.replace('_', ' ')}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted">Target ID</p>
              <Link to={`/app/workflows/${benchmark.targetId}`} className="text-sm text-primary hover:underline font-mono">
                {benchmark.targetId}
              </Link>
            </div>
            <div>
              <p className="text-xs text-text-muted">Dataset</p>
              <p className="text-sm">{dataset?.name || "Unknown"} ({dataset?.caseCount} cases)</p>
            </div>
          </div>
        </div>

        <div className="md:col-span-2 space-y-6">
          {compareMode && latestResult && previousResult ? (
            <div className="space-y-4">
              <h3 className="font-semibold text-text-primary flex items-center gap-2">
                <GitCommit className="h-4 w-4" />
                Version Comparison
              </h3>
              {renderComparison(latestResult, previousResult)}
            </div>
          ) : (
            <div className="space-y-4">
              <h3 className="font-semibold text-text-primary flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Latest Result
              </h3>
              
              {!latestResult ? (
                <div className="rounded-xl border border-dashed border-border p-8 text-center text-text-muted">
                  No evaluation has been run yet.
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center gap-4 text-sm text-text-muted">
                    <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" /> {formatDistanceToNow(new Date(latestResult.completedAt || latestResult.startedAt!), { addSuffix: true })}</span>
                    <span>Version: {latestResult.version || "Latest"}</span>
                    <span className="flex items-center gap-1.5 text-success"><CheckCircle2 className="h-4 w-4" /> {latestResult.passedCases} passed</span>
                    {latestResult.failedCases > 0 && (
                      <span className="flex items-center gap-1.5 text-danger"><XCircle className="h-4 w-4" /> {latestResult.failedCases} failed</span>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {benchmark.metrics.map(metric => {
                      const val = latestResult.metrics.find(m => m.metricId === metric.id)?.value || 0
                      return (
                        <div key={metric.id} className="rounded-xl border border-border bg-surface-raised p-4 flex flex-col justify-between h-24">
                          <span className="text-xs font-medium text-text-secondary">{metric.name}</span>
                          <span className="text-2xl font-bold">{formatMetricValue(metric.id, val)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
