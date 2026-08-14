import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Link as LinkIcon, Key, CheckCircle2 } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { type IntegrationDefinition } from "@/api/types"

interface ConnectFlowDialogProps {
  integration: IntegrationDefinition | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ConnectFlowDialog({ integration, open, onOpenChange }: ConnectFlowDialogProps) {
  const queryClient = useQueryClient()
  const [step, setStep] = React.useState<"initial" | "auth" | "success">("initial")
  const [name, setName] = React.useState("")
  const [apiKey, setApiKey] = React.useState("")

  React.useEffect(() => {
    if (open && integration) {
      setStep("initial")
      setName(`${integration.name} Connection`)
      setApiKey("")
    }
  }, [open, integration])

  const mutation = useMutation({
    mutationFn: () => {
      // In a real app, this might trigger an OAuth flow or save a credential and then the connection.
      // Here we just mock creating the connection directly.
      return api.createConnection({
        integrationId: integration!.id,
        name
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.connections.list })
      setStep("success")
    }
  })

  if (!integration) return null

  const handleConnect = () => {
    if (integration.authType === "oauth") {
      // Simulate OAuth redirect
      setTimeout(() => {
        mutation.mutate()
      }, 1000)
    } else {
      mutation.mutate()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        {step === "initial" && (
          <>
            <DialogHeader>
              <DialogTitle>Connect {integration.name}</DialogTitle>
              <DialogDescription>
                Configure the connection settings to link {integration.name} to AlterX.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Connection Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              {integration.authType === "api_key" && (
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input 
                    type="password" 
                    placeholder="Enter API key" 
                    value={apiKey} 
                    onChange={(e) => setApiKey(e.target.value)} 
                  />
                  <p className="text-xs text-muted-foreground">Keys are stored securely in the credentials vault.</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleConnect} disabled={mutation.isPending}>
                {mutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : integration.authType === "oauth" ? (
                  <LinkIcon className="mr-2 h-4 w-4" />
                ) : (
                  <Key className="mr-2 h-4 w-4" />
                )}
                {integration.authType === "oauth" ? "Connect via OAuth" : "Save Connection"}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "success" && (
          <div className="py-6 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
            <DialogTitle>Successfully Connected</DialogTitle>
            <DialogDescription>
              {name} is now connected and ready to use in your workflows and agents.
            </DialogDescription>
            <Button className="mt-4 w-full" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
