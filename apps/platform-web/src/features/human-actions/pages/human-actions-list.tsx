import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/feedback/empty-state"
import { ErrorState } from "@/components/feedback/error-state"
import { AlertCircle, FileQuestion, ShieldAlert, ArrowRight, Clock } from "lucide-react"
import { HumanActionVector } from "@/components/vectors/HumanActionVector"

function ActionTypeBadge({ type }: { type: string }) {
  switch (type) {
    case "approval":
      return <Badge variant="warning" className="gap-1"><ShieldAlert className="h-3 w-3" /> Approval</Badge>
    case "clarification":
      return <Badge variant="info" className="gap-1"><FileQuestion className="h-3 w-3" /> Clarification</Badge>
    case "escalation":
      return <Badge variant="danger" className="gap-1"><AlertCircle className="h-3 w-3" /> Escalation</Badge>
    default:
      return <Badge variant="outline">{type}</Badge>
  }
}

function ActionPriorityBadge({ priority }: { priority: string }) {
  switch (priority) {
    case "critical":
      return <Badge variant="danger">Critical</Badge>
    case "high":
      return <Badge variant="warning">High</Badge>
    case "low":
      return <Badge variant="secondary">Low</Badge>
    default:
      return <Badge variant="outline">Normal</Badge>
  }
}

export function HumanActionsList() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = React.useState("open")
  const [activeType, setActiveType] = React.useState<string>("all")

  const { data: actions, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.humanActions.list({ status: activeTab !== "all" ? activeTab : undefined }),
    queryFn: () => (api as any).getHumanActions({ status: activeTab !== "all" ? activeTab : undefined })
  })

  const filteredActions = React.useMemo(() => {
    if (!actions) return []
    if (activeType === "all") return actions
    return actions.filter((a: any) => a.type === activeType)
  }, [actions, activeType])

  if (isError) {
    return (
      <div className="flex-1 p-8">
        <ErrorState 
          title="Failed to load human actions"
          description="There was a problem communicating with the server."
          retryAction={<Button onClick={() => refetch()}>Try Again</Button>}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="relative">
        <PageHeader 
          title="Human Actions" 
          description="Handle manual approvals, clarifications, and escalations."
        />
        <div className="hidden md:block absolute right-8 top-4 w-[240px] h-20 opacity-70 pointer-events-none">
          <HumanActionVector />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8 pt-0">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
          <TabsList>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="claimed">Claimed</TabsTrigger>
            <TabsTrigger value="resolved">Resolved</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mb-4 flex gap-2">
          <Button 
            variant={activeType === "all" ? "primary" : "outline"} 
            size="sm"
            onClick={() => setActiveType("all")}
          >
            All Types
          </Button>
          <Button 
            variant={activeType === "approval" ? "primary" : "outline"} 
            size="sm"
            onClick={() => setActiveType("approval")}
          >
            Approvals
          </Button>
          <Button 
            variant={activeType === "clarification" ? "primary" : "outline"} 
            size="sm"
            onClick={() => setActiveType("clarification")}
          >
            Clarifications
          </Button>
          <Button 
            variant={activeType === "escalation" ? "primary" : "outline"} 
            size="sm"
            onClick={() => setActiveType("escalation")}
          >
            Escalations
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 rounded-lg bg-surface-hover animate-pulse" />
            ))}
          </div>
        ) : filteredActions.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title="No actions found"
            description={`There are no ${activeTab === "all" ? "" : activeTab} human actions matching the current filters.`}
          />
        ) : (
          <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Context</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredActions.map((action: any) => (
                  <TableRow 
                    key={action.id} 
                    className="cursor-pointer hover:bg-surface-hover"
                    onClick={() => navigate(`/app/human-actions/${action.id}`)}
                  >
                    <TableCell>
                      <ActionTypeBadge type={action.type} />
                    </TableCell>
                    <TableCell className="font-medium">
                      {action.title}
                    </TableCell>
                    <TableCell>
                      <ActionPriorityBadge priority={action.priority} />
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-text-muted flex flex-col">
                        <span>{action.workflowName || action.projectName || "System"}</span>
                        {action.nodeName && <span className="text-xs">{action.nodeName}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center text-sm text-text-muted">
                        <Clock className="mr-1 h-3 w-3" />
                        {new Date(action.createdAt).toLocaleDateString()}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="text-text-muted hover:text-text-primary">
                        View <ArrowRight className="ml-1 h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
