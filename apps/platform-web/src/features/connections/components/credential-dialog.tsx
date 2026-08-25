import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"


interface CredentialDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CredentialDialog({ open, onOpenChange }: CredentialDialogProps) {
  const queryClient = useQueryClient()
  
  const [name, setName] = React.useState("")
  const [connector, setConnector] = React.useState("")
  const [scope, setScope] = React.useState("")
  const [secretValue, setSecretValue] = React.useState("")

  React.useEffect(() => {
    if (open) {
      setName("")
      setConnector("")
      setScope("")
      setSecretValue("")
    }
  }, [open])

  const mutation = useMutation({
    mutationFn: () => api.createCredential({
      name,
      connector,
      scope,
      value: secretValue,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.credentials.list })
      onOpenChange(false)
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !connector || !scope || !secretValue) return
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Store Credential</DialogTitle>
          <DialogDescription>
            Add a new credential to the secure vault. It will be encrypted at rest.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input placeholder="e.g., Production DB Password" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Connector</Label>
              <Input placeholder="e.g., postgres" value={connector} onChange={(e) => setConnector(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Scope</Label>
              <Input placeholder="e.g., production" value={scope} onChange={(e) => setScope(e.target.value)} required />
            </div>
          </div>

          {mutation.isError && (
            <p className="text-sm text-destructive" role="alert">
              {mutation.error instanceof Error ? mutation.error.message : "Failed to save credential."}
            </p>
          )}

          <div className="space-y-2">
            <Label>Secret Value</Label>
            <Input type="password" placeholder="Paste secret here..." value={secretValue} onChange={(e) => setSecretValue(e.target.value)} required />
            <p className="text-xs text-muted-foreground mt-1">
              Value will be hashed and masked after saving.
            </p>
          </div>

          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending || !name || !connector || !scope || !secretValue}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save to Vault
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
