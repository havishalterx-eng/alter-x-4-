import { useQuery } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/common/status-badge"
import { Button } from "@/components/ui/button"
import { Activity, AlertCircle, CheckCircle2, Inbox, Terminal, Workflow, Zap, GitCommit, HeartPulse, Loader2 } from "lucide-react"
import { Link } from "react-router-dom"

export function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.dashboard.overview,
    queryFn: () => api.getDashboardOverview(),
  })

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="flex h-full flex-col">
      <PageHeader 
        title="Operational Dashboard" 
        description="Platform health and active execution state."
      >
        <Button variant="outline" size="sm" asChild>
          <Link to="/app/runs">View All Runs</Link>
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          
          {/* Key Metrics */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Workflows</CardTitle>
                <Workflow className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data.metrics.activeWorkflows}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Runs Today</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data.metrics.runsToday}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data.metrics.successRate}%</div>
              </CardContent>
            </Card>
            <Card className={data.metrics.needsAttention > 0 ? "border-amber-500/50 bg-amber-500/5" : ""}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Human Actions</CardTitle>
                <AlertCircle className={`h-4 w-4 ${data.metrics.needsAttention > 0 ? "text-amber-500" : "text-muted-foreground"}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data.metrics.needsAttention}</div>
                {data.metrics.needsAttention > 0 && (
                  <Link to="/app/human-actions" className="text-xs text-amber-500 hover:underline mt-1 block font-medium">
                    View pending actions
                  </Link>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            
            {/* Live Runs */}
            <div className="lg:col-span-2 space-y-4">
              <h3 className="font-medium flex items-center gap-2"><Terminal className="h-4 w-4" /> Live Executions</h3>
              <div className="rounded-xl border border-ax-border bg-ax-surface-1 overflow-hidden">
                {!data.liveRuns.length ? (
                  <div className="p-6 text-center text-muted-foreground text-sm">No active runs.</div>
                ) : (
                  <table className="w-full text-sm text-left">
                    <thead className="bg-ax-surface-2 text-xs text-muted-foreground uppercase border-b border-ax-border">
                      <tr>
                        <th className="px-4 py-3 font-medium">Run ID</th>
                        <th className="px-4 py-3 font-medium">Workflow</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium text-right">Started</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.liveRuns.map((run) => (
                        <tr key={run.id} className="hover:bg-ax-surface-2 transition-colors">
                          <td className="px-4 py-3 font-medium">
                            <Link to={`/app/runs/${run.id}`} className="hover:underline">{run.id}</Link>
                          </td>
                          <td className="px-4 py-3 truncate max-w-[150px]">{run.workflowName || run.projectName}</td>
                          <td className="px-4 py-3"><StatusBadge status={run.status as any} /></td>
                          <td className="px-4 py-3 text-right text-muted-foreground">
                            {run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Project Builds */}
              <h3 className="font-medium flex items-center gap-2 mt-8"><GitCommit className="h-4 w-4" /> Active Project Builds</h3>
              <div className="rounded-xl border border-ax-border bg-ax-surface-1 overflow-hidden">
                {!data.projectBuilds.length ? (
                  <div className="p-6 text-center text-muted-foreground text-sm">No active project builds.</div>
                ) : (
                  <table className="w-full text-sm text-left">
                    <thead className="bg-ax-surface-2 text-xs text-muted-foreground uppercase border-b border-ax-border">
                      <tr>
                        <th className="px-4 py-3 font-medium">Project</th>
                        <th className="px-4 py-3 font-medium">Run ID</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.projectBuilds.map((run) => (
                        <tr key={run.id} className="hover:bg-ax-surface-2 transition-colors">
                          <td className="px-4 py-3 font-medium">{run.projectName}</td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                            <Link to={`/app/runs/${run.id}`} className="hover:underline">{run.id}</Link>
                          </td>
                          <td className="px-4 py-3"><StatusBadge status={run.status as any} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Sidebar (Health & Events) */}
            <div className="space-y-6">
              
              <div className="rounded-xl border border-ax-border bg-ax-surface-1 p-5">
                <h3 className="font-medium flex items-center gap-2 mb-4"><HeartPulse className="h-4 w-4 text-emerald-500" /> Platform Health</h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Healthy Workflows</span>
                    <span className="font-medium text-emerald-500">{data.health.healthy}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Warning</span>
                    <span className="font-medium text-amber-500">{data.health.warning}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Critical Issues</span>
                    <span className="font-medium text-destructive">{data.health.critical}</span>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="w-full mt-4" asChild>
                  <Link to="/app/workflows/health">View Full Report</Link>
                </Button>
              </div>

              <div className="rounded-xl border border-ax-border bg-ax-surface-1 p-5">
                <h3 className="font-medium flex items-center gap-2 mb-4"><Zap className="h-4 w-4" /> Trigger Status</h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Active Endpoints</span>
                    <span className="font-medium">{data.triggerSummary.enabled}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Needs Config</span>
                    <span className="font-medium text-amber-500">{data.triggerSummary.needsConfiguration}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Failing</span>
                    <span className="font-medium text-destructive">{data.triggerSummary.failing}</span>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="w-full mt-4" asChild>
                  <Link to="/app/settings/webhooks">Manage Webhooks</Link>
                </Button>
              </div>

              <div className="rounded-xl border border-ax-border bg-ax-surface-1 p-0 overflow-hidden">
                <div className="p-4 border-b border-ax-border bg-ax-surface-2 flex items-center justify-between">
                  <h3 className="font-medium flex items-center gap-2 text-sm"><Inbox className="h-4 w-4" /> Recent Events</h3>
                </div>
                <div className="divide-y divide-border">
                  {!data.recentEvents.length ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">No events today.</div>
                  ) : (
                    data.recentEvents.slice(0, 3).map((evt) => (
                      <Link 
                        key={evt.id} 
                        to={`/app/events/${evt.id}`}
                        className="block p-3 hover:bg-ax-surface-2 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-sm font-medium truncate">{evt.type}</span>
                          <span className="text-[10px] uppercase text-muted-foreground shrink-0">{evt.status}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">{new Date(evt.receivedAt).toLocaleTimeString()}</div>
                      </Link>
                    ))
                  )}
                </div>
                <div className="p-3 border-t border-ax-border bg-ax-surface-2">
                  <Button variant="ghost" size="sm" className="w-full text-xs" asChild>
                    <Link to="/app/events">View Event Inbox</Link>
                  </Button>
                </div>
              </div>

            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
