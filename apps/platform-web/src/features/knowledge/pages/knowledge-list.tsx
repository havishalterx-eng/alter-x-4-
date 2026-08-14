import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { Plus, Database, Globe, UploadCloud, Puzzle } from "lucide-react"
import { formatDistanceToNow } from "date-fns"

import { PageHeader } from "@/components/common/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { AddSourceDialog } from "../components/add-source-dialog"
import { type KnowledgeSourceType } from "@/api/types"
import { KnowledgeVector } from "@/components/vectors/KnowledgeVector"

const SourceIcon = ({ type, className }: { type: KnowledgeSourceType; className?: string }) => {
  switch (type) {
    case "file_upload": return <UploadCloud className={className} />
    case "website": return <Globe className={className} />
    case "database": return <Database className={className} />
    default: return <Puzzle className={className} />
  }
}

export function KnowledgeListPage() {
  const navigate = useNavigate()
  const [addDialogOpen, setAddDialogOpen] = useState(false)

  const { data: sources, isLoading } = useQuery({
    queryKey: queryKeys.knowledge.sources.list,
    queryFn: () => api.getKnowledgeSources()
  })

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="relative">
        <PageHeader 
          title="Knowledge Sources"
          description="Manage datasets, uploaded files, and integrations that power AlterX intelligence."
          primaryAction={
            <Button onClick={() => setAddDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Source
            </Button>
          }
        />
        <div className="hidden lg:block absolute right-8 top-2 w-[140px] h-24 opacity-70 pointer-events-none">
          <KnowledgeVector />
        </div>
      </div>

      <AddSourceDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
          {[1, 2, 3].map(i => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="h-24 bg-muted/50" />
              <CardContent className="h-32" />
            </Card>
          ))}
        </div>
      ) : sources && sources.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
          {sources.map(source => (
            <Card 
              key={source.id} 
              className="cursor-pointer ax-hover-fill ax-workflow-card"
              onClick={() => navigate(`/app/knowledge/sources/${source.id}`)}
            >
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-primary/10 rounded-md text-primary">
                    <SourceIcon type={source.type} className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{source.name}</CardTitle>
                    <CardDescription className="capitalize mt-1 text-xs">
                      {source.type.replace('_', ' ')}
                    </CardDescription>
                  </div>
                </div>
                <Badge variant={
                  source.status === 'failed' ? 'danger' :
                  source.status === 'ready' ? 'default' : 'secondary'
                }>
                  {source.status}
                </Badge>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex flex-col">
                    <span className="text-muted-foreground">Documents</span>
                    <span className="font-medium">{source.documentCount}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-muted-foreground">Vector Chunks</span>
                    <span className="font-medium">{source.chunkCount}</span>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="border-t bg-muted/20 px-6 py-3 text-xs text-muted-foreground">
                <div className="flex w-full justify-between">
                  <span>Created {formatDistanceToNow(new Date(source.createdAt), { addSuffix: true })}</span>
                  {source.lastSyncedAt && (
                    <span>Synced {formatDistanceToNow(new Date(source.lastSyncedAt), { addSuffix: true })}</span>
                  )}
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <div className="border border-dashed rounded-lg p-12 text-center text-muted-foreground mt-6">
          <Database className="mx-auto h-12 w-12 mb-4 opacity-50 text-primary" />
          <h3 className="text-lg font-medium text-foreground mb-2">No knowledge sources</h3>
          <p className="mb-6 max-w-md mx-auto">Add a source to ingest documents into the semantic index for retrieval.</p>
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add your first source
          </Button>
        </div>
      )}
    </div>
  )
}
