import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { UploadCloud, Globe, Database, Puzzle } from "lucide-react"
import { Loader2 } from "lucide-react"
import { type KnowledgeSourceType } from "@/api/types"

interface AddSourceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddSourceDialog({ open, onOpenChange }: AddSourceDialogProps) {
  const queryClient = useQueryClient()
  
  const [name, setName] = React.useState("")
  const [type, setType] = React.useState<KnowledgeSourceType>("file_upload")
  const [connectionId, setConnectionId] = React.useState("")

  React.useEffect(() => {
    if (open) {
      setName("")
      setType("file_upload")
      setConnectionId("")
    }
  }, [open])

  const mutation = useMutation({
    mutationFn: () => api.createKnowledgeSource({
      name,
      type,
      connectionId: connectionId || undefined
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.sources.list })
      onOpenChange(false)
    }
  })

  const needsConnection = ["notion", "google_drive", "confluence", "database", "api"].includes(type)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name) return
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Knowledge Source</DialogTitle>
          <DialogDescription>
            Connect a new data source to ingest documents and chunks into AlterX knowledge.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Source Type</Label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div 
                className={`border rounded-md p-3 flex flex-col items-center justify-center cursor-pointer transition-colors hover:bg-surface-hover ${type === 'file_upload' ? 'border-primary bg-primary/5 text-primary' : 'border-border'}`}
                onClick={() => setType("file_upload")}
              >
                <UploadCloud className="h-6 w-6 mb-2 text-muted-foreground" />
                <span className="text-sm font-medium">Files</span>
              </div>
              <div 
                className={`border rounded-md p-3 flex flex-col items-center justify-center cursor-pointer transition-colors hover:bg-surface-hover ${type === 'website' ? 'border-primary bg-primary/5 text-primary' : 'border-border'}`}
                onClick={() => setType("website")}
              >
                <Globe className="h-6 w-6 mb-2 text-muted-foreground" />
                <span className="text-sm font-medium">Website</span>
              </div>
              <div 
                className={`border rounded-md p-3 flex flex-col items-center justify-center cursor-pointer transition-colors hover:bg-surface-hover ${type === 'notion' ? 'border-primary bg-primary/5 text-primary' : 'border-border'}`}
                onClick={() => setType("notion")}
              >
                <Puzzle className="h-6 w-6 mb-2 text-muted-foreground" />
                <span className="text-sm font-medium">Integration</span>
              </div>
              <div 
                className={`border rounded-md p-3 flex flex-col items-center justify-center cursor-pointer transition-colors hover:bg-surface-hover ${type === 'database' ? 'border-primary bg-primary/5 text-primary' : 'border-border'}`}
                onClick={() => setType("database")}
              >
                <Database className="h-6 w-6 mb-2 text-muted-foreground" />
                <span className="text-sm font-medium">Database</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Name</Label>
            <Input placeholder="e.g., Q3 Support Policies" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          {needsConnection && (
            <div className="space-y-2">
              <Label>Select Connection</Label>
              <Select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
                <option value="">Select an active connection...</option>
                <option value="conn_01">Acme Notion Auth</option>
                <option value="conn_02">PostgreSQL DB (Prod)</option>
              </Select>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending || !name}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Source
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
