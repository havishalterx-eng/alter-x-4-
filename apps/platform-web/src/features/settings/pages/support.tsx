import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Loader2, ShieldCheck } from "lucide-react"

export function SettingsSupport() {
  const [requireApproval, setRequireApproval] = useState(true)

  const { data: requests, isLoading } = useQuery({
    queryKey: queryKeys.admin.support.requests,
    queryFn: () => api.admin.support.list()
  })

  // Filter to just this tenant for demo purposes
  const tenantRequests = requests?.filter(r => r.tenantId === "ten-1") || []

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Support Access"
        description="Control how AlterX support engineers can access your workspace data."
      />

      <Card className="p-6 bg-slate-900 border-slate-800">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h3 className="text-lg font-medium text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Require Access Approval
            </h3>
            <p className="text-sm text-slate-400 max-w-2xl">
              When enabled, AlterX support engineers must request explicit permission from a workspace administrator before they can access your workspace data to troubleshoot issues.
            </p>
          </div>
          <div>
            <Button 
              variant={requireApproval ? "primary" : "outline"}
              className={requireApproval ? "bg-primary hover:bg-indigo-700 text-white" : "border-slate-700 text-slate-300 hover:bg-slate-800"}
              onClick={() => setRequireApproval(!requireApproval)}
            >
              {requireApproval ? "Enabled" : "Disabled"}
            </Button>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <h3 className="text-lg font-medium text-slate-200">Access History</h3>
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <Table>
            <TableHeader className="bg-slate-950/50">
              <TableRow className="border-slate-800">
                <TableHead className="text-slate-400">Date</TableHead>
                <TableHead className="text-slate-400">Requested By</TableHead>
                <TableHead className="text-slate-400">Reason</TableHead>
                <TableHead className="text-slate-400">Status</TableHead>
                <TableHead className="text-slate-400">Approved By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-slate-500">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : tenantRequests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-slate-500">
                    No support access requests found.
                  </TableCell>
                </TableRow>
              ) : (
                tenantRequests.map((r) => (
                  <TableRow key={r.id} className="border-slate-800">
                    <TableCell className="text-slate-300">
                      {new Date(r.requestedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-slate-200">{r.requestedBy.name}</div>
                    </TableCell>
                    <TableCell className="text-slate-300 max-w-[250px] truncate" title={r.reason}>
                      {r.reason}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        r.status === "approved" || r.status === "active" ? "text-emerald-400 border-emerald-400/20" :
                        r.status === "pending" ? "text-amber-400 border-amber-400/20" :
                        "text-slate-400 border-slate-700"
                      }>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-400">
                      {r.approvedBy?.name || "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
