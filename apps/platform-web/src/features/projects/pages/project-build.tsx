import * as React from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, Loader2, CheckCircle2, Circle, Play, Download, RefreshCcw, Box, AlertTriangle, Hand } from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useRunStreamStore } from "../../runs/stores/useRunStreamStore"
import { FileTree } from "../components/file-tree"
import { DiffViewer } from "../components/diff-viewer"
import { TerminalView } from "../../runs/components/terminal-view"
import { type ProjectFile } from "@/api/types"

export function ProjectBuild() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  
  const { connect, disconnect, terminalLines, clear, runStatus } = useRunStreamStore()

  const { data: project } = useQuery({
    queryKey: queryKeys.projects.detail(projectId!),
    queryFn: () => api.getProject(projectId!),
    enabled: !!projectId,
  })

  // We fetch the run associated with the project to get its runId
  const { data: run } = useQuery({
    queryKey: queryKeys.projects.build(projectId!),
    queryFn: () => api.getProjectBuild(projectId!),
    enabled: !!projectId,
  })

  const { data: files = [] } = useQuery({
    queryKey: queryKeys.projects.files(projectId!),
    queryFn: () => api.getProjectFiles(projectId!),
    enabled: !!projectId,
  })

  const { data: changes = [] } = useQuery({
    queryKey: queryKeys.projects.changes(projectId!),
    queryFn: () => api.getProjectChanges(projectId!),
    enabled: !!projectId,
  })

  const { data: tests = [] } = useQuery({
    queryKey: queryKeys.projects.tests(projectId!),
    queryFn: () => api.getProjectTests(projectId!),
    enabled: !!projectId,
  })

  const { data: audit = [] } = useQuery({
    queryKey: queryKeys.projects.audit(projectId!),
    queryFn: () => api.getProjectAudit(projectId!),
    enabled: !!projectId,
  })

  React.useEffect(() => {
    if (run?.id) {
      clear()
      connect(run.id)
    }
    return () => disconnect()
  }, [run?.id])

  const [selectedFile, setSelectedFile] = React.useState<ProjectFile | undefined>()

  if (!project) return null

  // Mock progress calculation
  const progress = runStatus === "completed" ? 100 : runStatus === "running" ? 68 : 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border bg-surface p-4 shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold tracking-tight">{project.name}</h1>
              {runStatus === "running" && (
                <span className="flex items-center text-xs font-medium text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                  <RefreshCcw className="h-3 w-3 mr-1 animate-spin" />
                  Building
                </span>
              )}
              {runStatus === "waiting" && (
                <span className="flex items-center text-xs font-medium text-warning bg-warning/10 px-2 py-0.5 rounded-full">
                  <Hand className="h-3 w-3 mr-1" />
                  Waiting for Human
                </span>
              )}
              {runStatus === "completed" && (
                <span className="flex items-center text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Build Ready
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
              <span>Project Build Execution</span>
              {run && (
                <>
                  <span>•</span>
                  <span className="font-mono text-xs">Run {run.id}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Download Source
          </Button>
          <Button variant="primary" disabled={runStatus !== "completed"}>
            <Play className="mr-2 h-4 w-4" />
            Deploy
          </Button>
        </div>
      </div>

      <div className="bg-surface-raised border-b border-border p-4 flex items-center gap-6 shrink-0">
        <div className="flex-1 max-w-xl">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium text-foreground">Build Progress</span>
            <span className="text-muted-foreground">{progress}%</span>
          </div>
          <div className="h-2 bg-surface overflow-hidden rounded-full border border-border">
            <div className={cn(
              "h-full transition-all duration-500", 
              runStatus === "waiting" ? "bg-warning" : "bg-primary"
            )} style={{ width: `${progress}%` }} />
          </div>
        </div>
        
        <div className="flex gap-8 text-sm">
          <div className="flex items-center gap-2 text-emerald-500">
            <CheckCircle2 className="h-4 w-4" />
            <span>3 phases done</span>
          </div>
          <div className="flex items-center gap-2 text-primary">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>UI implementation</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Circle className="h-4 w-4" />
            <span>Testing</span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-64 border-r border-border bg-surface-raised/50 flex flex-col">
          <div className="p-3 border-b border-border font-medium text-sm">Project Files</div>
          <div className="flex-1 overflow-y-auto">
            <FileTree 
              files={files} 
              selectedFileId={selectedFile?.id}
              onSelect={setSelectedFile}
            />
          </div>
        </div>
        
        <div className="flex-1 flex flex-col min-w-0 bg-surface">
          <Tabs defaultValue="terminal" className="flex-1 flex flex-col">
            <div className="border-b border-border px-6 pt-4 shrink-0">
              <TabsList>
                <TabsTrigger value="code" disabled={!selectedFile || selectedFile.type === "directory"}>Code</TabsTrigger>
                <TabsTrigger value="changes">Changes</TabsTrigger>
                <TabsTrigger value="terminal">Terminal</TabsTrigger>
                <TabsTrigger value="tests">Tests</TabsTrigger>
                <TabsTrigger value="audit">Audit</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
            </div>
            
            <div className="flex-1 overflow-hidden p-6">
              <TabsContent value="code" className="h-full m-0">
                {selectedFile?.type === "file" ? (
                  <div className="h-full rounded-xl border border-border bg-[#1e1e1e] p-4 text-gray-300 font-mono text-sm overflow-auto">
                    {/* Minimal mock code viewer */}
                    <pre><code>{`// ${selectedFile.name}
// Content placeholder for mock.`}</code></pre>
                  </div>
                ) : null}
              </TabsContent>

              <TabsContent value="changes" className="h-full m-0 space-y-6 overflow-y-auto">
                {changes.length === 0 ? (
                  <div className="text-center text-muted-foreground pt-12">No changes recorded yet.</div>
                ) : (
                  changes.map(file => (
                    <div key={file.id} className="space-y-3">
                      <div className="font-medium text-sm flex items-center gap-2">
                        <span>{file.path}</span>
                        <span className="text-[10px] uppercase font-bold bg-primary-soft text-primary px-1.5 rounded-sm">
                          Modified
                        </span>
                      </div>
                      <DiffViewer content={file.content || ""} />
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="terminal" className="h-full m-0">
                <TerminalView lines={terminalLines} className="h-full" />
              </TabsContent>

              <TabsContent value="tests" className="h-full m-0 overflow-y-auto">
                <div className="space-y-4 max-w-3xl">
                  {tests.map(test => (
                    <div key={test.id} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-surface-raised">
                      {test.status === "passed" && <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />}
                      {test.status === "failed" && <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />}
                      {test.status === "skipped" && <Circle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />}
                      
                      <div className="flex-1">
                        <div className="flex justify-between items-start">
                          <h4 className="font-medium text-sm">{test.name}</h4>
                          {test.durationMs && <span className="text-xs font-mono text-muted-foreground">{test.durationMs}ms</span>}
                        </div>
                        {test.error && (
                          <div className="mt-2 text-sm text-destructive bg-destructive/10 p-2 rounded border border-destructive/20 font-mono">
                            {test.error}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="audit" className="h-full m-0 overflow-y-auto">
                <div className="space-y-4 max-w-3xl">
                  {audit.map((item, i) => (
                    <div key={i} className="flex items-start gap-4 p-4 rounded-xl border border-border bg-surface-raised">
                      <div className="w-32 font-medium text-sm shrink-0">{item.category}</div>
                      <div className="w-24 shrink-0">
                        {item.status === "pass" && <span className="text-xs font-bold uppercase text-emerald-500 bg-emerald-500/20 px-2 py-1 rounded">Pass</span>}
                        {item.status === "warning" && <span className="text-xs font-bold uppercase text-yellow-500 bg-yellow-500/20 px-2 py-1 rounded">Warning</span>}
                        {item.status === "fail" && <span className="text-xs font-bold uppercase text-destructive bg-destructive/20 px-2 py-1 rounded">Fail</span>}
                      </div>
                      <div className="text-sm text-muted-foreground flex-1">{item.message}</div>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="preview" className="h-full m-0">
                <div className="h-full border border-border rounded-xl bg-white flex flex-col items-center justify-center text-slate-400">
                  <Box className="h-12 w-12 mb-4 opacity-50" />
                  <p>Preview placeholder.</p>
                  <p className="text-xs mt-2">In a real implementation, this would be an isolated iframe rendering the built assets.</p>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
