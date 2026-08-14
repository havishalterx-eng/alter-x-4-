import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { formatDistanceToNow } from "date-fns"
import { Plus, Key, Trash2, AlertCircle } from "lucide-react"

import { PageHeader } from "@/components/common/page-header"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { CredentialDialog } from "../components/credential-dialog"

export function CredentialsVaultPage() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = React.useState(false)

  const { data: credentials, isLoading } = useQuery({
    queryKey: queryKeys.credentials.list,
    queryFn: () => api.getCredentials()
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteCredential(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.credentials.list })
    },
    onError: (err: any) => {
      alert(err.message || "Failed to delete credential.")
    }
  })

  return (
    <div className="flex-1 p-8 overflow-y-auto max-w-5xl mx-auto w-full">
      <PageHeader 
        title="Credentials Vault"
        description="Securely manage API keys, tokens, and OAuth secrets used by connections."
        primaryAction={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Store Credential
          </Button>
        }
      />

      <CredentialDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      <div className="mt-8 bg-card border rounded-lg overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-[250px]">Name / Provider</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Value (Masked)</TableHead>
              <TableHead>Usage</TableHead>
              <TableHead>Last Used</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Loading vault...
                </TableCell>
              </TableRow>
            ) : credentials && credentials.length > 0 ? (
              credentials.map(cred => (
                <TableRow key={cred.id}>
                  <TableCell>
                    <div className="font-medium flex items-center gap-2">
                      <Key className="h-4 w-4 text-muted-foreground" />
                      {cred.name}
                    </div>
                    {cred.provider && (
                      <div className="text-xs text-muted-foreground mt-1 ml-6">{cred.provider}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {cred.type.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {cred.maskedValue || "••••••••••••••••"}
                  </TableCell>
                  <TableCell>
                    {cred.usedByConnectionIds.length > 0 ? (
                      <span className="text-sm">{cred.usedByConnectionIds.length} connections</span>
                    ) : (
                      <span className="text-sm text-muted-foreground italic flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> Unused
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {cred.lastUsedAt ? formatDistanceToNow(new Date(cred.lastUsedAt), { addSuffix: true }) : "Never"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        if (window.confirm(`Delete '${cred.name}'? This cannot be undone.`)) {
                          deleteMutation.mutate(cred.id)
                        }
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12">
                  <Key className="mx-auto h-8 w-8 text-muted-foreground mb-4 opacity-50" />
                  <p className="text-muted-foreground">Your vault is empty.</p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
