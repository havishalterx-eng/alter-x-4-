import { useMutation } from "@tanstack/react-query"
import { DownloadCloud, Trash2, AlertTriangle, ShieldCheck } from "lucide-react"

import { PageHeader } from "@/components/common/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { api } from "@/api/client"

export function DataControlsPage() {
  const exportMutation = useMutation({
    mutationFn: () => api.requestDataExport(),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteWorkspaceData("all"),
  })

  return (
    <div className="flex-1 p-8 overflow-y-auto max-w-4xl mx-auto w-full">
      <PageHeader 
        title="Data & Privacy Controls"
        description="Manage your workspace data, export your information, and control data retention."
      />

      <div className="space-y-6 mt-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <DownloadCloud className="h-5 w-5 text-primary" />
              <CardTitle>Data Export</CardTitle>
            </div>
            <CardDescription>
              Download a complete archive of your workspace data, including workflows, projects, knowledge sources, and history.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            The export will be prepared in JSON format and may take several minutes depending on the size of your workspace.
            {exportMutation.isSuccess && (
              <div className="mt-4 p-3 bg-green-500/10 text-green-600 border border-green-500/20 rounded-md font-medium flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                Export request generated. A download link will be emailed to you shortly.
              </div>
            )}
          </CardContent>
          <CardFooter className="border-t px-6 py-4">
            <Button onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending || exportMutation.isSuccess}>
              {exportMutation.isPending ? "Preparing Export..." : "Request Data Export"}
            </Button>
          </CardFooter>
        </Card>

        <Card className="border-destructive/50 shadow-sm shadow-destructive/10">
          <CardHeader>
            <div className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              <CardTitle>Data Deletion</CardTitle>
            </div>
            <CardDescription className="text-destructive/80">
              Permanently delete specific segments of data or your entire workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
              <div className="text-sm text-destructive">
                <span className="font-semibold block mb-1">Warning: This action cannot be undone.</span>
                Deleting your workspace data will immediately remove all access to workflows, runs, and connected knowledge sources.
              </div>
            </div>
            {deleteMutation.isSuccess && (
              <div className="text-sm font-medium text-destructive mt-2">
                Deletion process initiated. You will be signed out shortly.
              </div>
            )}
          </CardContent>
          <CardFooter className="border-t border-destructive/20 px-6 py-4 bg-destructive/5">
            <Button 
              variant="danger" 
              onClick={() => {
                if (window.confirm("Are you absolutely sure? This will delete all mock data.")) {
                  deleteMutation.mutate()
                }
              }}
              disabled={deleteMutation.isPending || deleteMutation.isSuccess}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete All Workspace Data"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
