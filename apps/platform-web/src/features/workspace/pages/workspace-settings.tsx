import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { RequirePermission } from "@/features/permissions/components/require-permission"

export function WorkspaceSettings() {
  return (
    <RequirePermission permission="workspace.manage">
      <div className="space-y-10">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Workspace General Settings</h1>
          <p className="text-text-secondary mt-2">Manage your workspace identity and configuration.</p>
        </div>

        <WorkspaceIdentityForm />
        <DangerZone />
      </div>
    </RequirePermission>
  )
}

function WorkspaceIdentityForm() {
  const queryClient = useQueryClient()
  
  // Using the first workspace as the "current" one for the mock
  const { data: workspaces, isLoading } = useQuery({
    queryKey: queryKeys.workspace.all,
    queryFn: () => api.getWorkspaces(),
  })
  
  const currentWorkspace = workspaces?.[0]
  
  const [name, setName] = React.useState("")
  const [slug, setSlug] = React.useState("")
  
  React.useEffect(() => {
    if (currentWorkspace) {
      setName(currentWorkspace.name)
      setSlug(currentWorkspace.slug)
    }
  }, [currentWorkspace])

  const { mutate, isPending } = useMutation({
    mutationFn: (data: { name: string; slug: string }) => {
      if (!currentWorkspace) throw new Error("No workspace")
      return api.updateWorkspace(currentWorkspace.id, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspace.all })
      toast.success("Workspace settings saved")
    },
    onError: () => {
      toast.error("Failed to update workspace")
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    mutate({ name, slug })
  }

  if (isLoading || !currentWorkspace) {
    return <div className="h-64 flex items-center justify-center border rounded-xl border-border"><Loader2 className="animate-spin text-text-muted" /></div>
  }

  const isDirty = name !== currentWorkspace.name || slug !== currentWorkspace.slug

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="px-6 py-5 border-b border-border">
        <h3 className="text-lg font-medium text-text-primary">Workspace Identity</h3>
      </div>
      <form onSubmit={handleSubmit} className="px-6 py-6 space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-text-primary">Workspace Name</label>
            <Input 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
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
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                required
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end pt-4">
          <Button type="submit" disabled={!isDirty || isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </div>
      </form>
    </div>
  )
}

function DangerZone() {
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [confirmText, setConfirmText] = React.useState("")
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: workspaces } = useQuery({
    queryKey: queryKeys.workspace.all,
    queryFn: () => api.getWorkspaces(),
  })

  const currentWorkspace = workspaces?.[0]

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!currentWorkspace) throw new Error("No workspace")
      return api.deleteWorkspace(currentWorkspace.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspace.all })
      toast.success("Workspace deleted successfully")
      setShowConfirm(false)
      navigate("/login")
    },
    onError: () => {
      toast.error("Failed to delete workspace")
    }
  })

  const canDelete = confirmText === (currentWorkspace?.name ?? "")

  return (
    <>
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 overflow-hidden mt-10">
        <div className="px-6 py-5 border-b border-red-500/20">
          <h3 className="text-lg font-medium text-red-500">Danger Zone</h3>
        </div>
        <div className="px-6 py-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-ax-text">Delete workspace</h4>
              <p className="text-sm text-ax-text-muted mt-1">
                Permanently delete this workspace and all of its data. This action cannot be undone.
              </p>
            </div>
            <Button variant="danger" onClick={() => setShowConfirm(true)}>
              Delete workspace
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-500">Delete Workspace</DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{currentWorkspace?.name}</strong> and all associated
              workflows, projects, runs, knowledge, connections, and billing data. This action is irreversible.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <label className="text-sm font-medium text-ax-text">
              Type <span className="font-mono text-red-400">{currentWorkspace?.name}</span> to confirm
            </label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={currentWorkspace?.name}
              autoFocus
            />
          </div>
          <DialogFooter className="pt-4">
            <Button variant="secondary" onClick={() => { setShowConfirm(false); setConfirmText("") }}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={!canDelete || deleteMutation.isPending}
              loading={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
