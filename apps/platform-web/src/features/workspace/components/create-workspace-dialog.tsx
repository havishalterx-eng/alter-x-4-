import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"

interface CreateWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateWorkspaceDialog({ open, onOpenChange }: CreateWorkspaceDialogProps) {
  const [name, setName] = React.useState("")
  const [slug, setSlug] = React.useState("")
  const queryClient = useQueryClient()

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setName(newName)
    setSlug(newName.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""))
  }

  const { mutate, isPending } = useMutation({
    mutationFn: (data: { name: string; slug: string }) => api.createWorkspace(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspace.all })
      toast.success("Workspace created successfully")
      onOpenChange(false)
      setName("")
      setSlug("")
    },
    onError: () => {
      toast.error("Failed to create workspace")
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim() && slug.trim()) {
      mutate({ name, slug })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Workspace</DialogTitle>
          <DialogDescription>
            Add a new workspace to organize your team's workflows.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-text-primary">Workspace name</label>
            <Input 
              autoFocus
              placeholder="E.g. Acme Marketing" 
              value={name} 
              onChange={handleNameChange}
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-text-primary">Workspace URL</label>
            <div className="flex">
              <span className="inline-flex items-center rounded-l-md border border-r-0 border-border bg-surface-hover px-3 text-sm text-text-muted">
                alterx.ai/
              </span>
              <Input 
                className="rounded-l-none"
                placeholder="acme-marketing" 
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                required
              />
            </div>
          </div>
          <DialogFooter className="pt-4">
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
