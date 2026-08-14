import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
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
  const [type, setType] = React.useState<any>("api_key")
  const [provider, setProvider] = React.useState("")
  const [secretValue, setSecretValue] = React.useState("")

  React.useEffect(() => {
    if (open) {
      setName("")
      setType("api_key")
      setProvider("")
      setSecretValue("")
    }
  }, [open])

  const mutation = useMutation({
    mutationFn: () => api.createCredential({
      name,
      type,
      provider: provider || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.credentials.list })
      onOpenChange(false)
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !secretValue) return
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
              <Label>Type</Label>
              <Select value={type} onChange={(e) => setType(e.target.value as any)}>
                <option value="api_key">API Key</option>
                <option value="token">Token</option>
                <option value="secret">Generic Secret</option>
                <option value="username_password">Username/Password</option>
                <option value="oauth">OAuth App Secret</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Provider (Optional)</Label>
              <Input placeholder="e.g., OpenAI" value={provider} onChange={(e) => setProvider(e.target.value)} />
            </div>
          </div>

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
            <Button type="submit" disabled={mutation.isPending || !name || !secretValue}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save to Vault
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
