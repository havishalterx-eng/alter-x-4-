import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Save } from "lucide-react"

import { PageHeader } from "@/components/common/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"

export function MemorySettingsPage() {
  const queryClient = useQueryClient()

  const { data: config, isLoading } = useQuery({
    queryKey: queryKeys.knowledge.memory,
    queryFn: () => api.getMemoryConfiguration()
  })

  const [localConfig, setLocalConfig] = React.useState(config)

  React.useEffect(() => {
    if (config) {
      setLocalConfig(config)
    }
  }, [config])

  const mutation = useMutation({
    mutationFn: (data: typeof config) => api.updateMemoryConfiguration(data!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.memory })
    }
  })

  if (isLoading || !localConfig) {
    return <div className="p-8 text-muted-foreground">Loading memory settings...</div>
  }

  const handleSave = () => {
    mutation.mutate(localConfig)
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto max-w-4xl mx-auto w-full">
      <PageHeader 
        title="Memory Settings"
        description="Configure how AlterX retains and utilizes memory across workflows and conversations."
      />

      <div className="space-y-6 mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Memory Scopes</CardTitle>
            <CardDescription>Enable or disable memory capabilities globally.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base">Conversation Memory</Label>
                <p className="text-sm text-muted-foreground">
                  Allow conversational agents to remember context from past messages in the same thread.
                </p>
              </div>
              <Switch 
                checked={localConfig.conversationMemoryEnabled}
                onCheckedChange={(c) => setLocalConfig({ ...localConfig, conversationMemoryEnabled: c })}
              />
            </div>
            
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base">Workflow Memory</Label>
                <p className="text-sm text-muted-foreground">
                  Allow workflows to store variables across different executions.
                </p>
              </div>
              <Switch 
                checked={localConfig.workflowMemoryEnabled}
                onCheckedChange={(c) => setLocalConfig({ ...localConfig, workflowMemoryEnabled: c })}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base">Workspace Memory (Shared)</Label>
                <p className="text-sm text-muted-foreground">
                  Allow agents to access a shared global memory across all workflows.
                </p>
              </div>
              <Switch 
                checked={localConfig.workspaceMemoryEnabled}
                onCheckedChange={(c) => setLocalConfig({ ...localConfig, workspaceMemoryEnabled: c })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Retention & Privacy</CardTitle>
            <CardDescription>Manage data lifecycle and sensitive information handling.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Retention Period (Days)</Label>
              <div className="flex items-center gap-4">
                <Input 
                  type="number" 
                  value={localConfig.retentionDays || 30} 
                  onChange={(e) => setLocalConfig({ ...localConfig, retentionDays: parseInt(e.target.value) || 30 })}
                  className="max-w-[200px]"
                />
                <span className="text-sm text-muted-foreground">Days before memory is auto-purged</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base">Store Sensitive Data</Label>
                <p className="text-sm text-muted-foreground">
                  Allow storing PII or sensitive patterns in long-term memory. If disabled, they will be redacted.
                </p>
              </div>
              <Switch 
                checked={localConfig.allowSensitiveData}
                onCheckedChange={(c) => setLocalConfig({ ...localConfig, allowSensitiveData: c })}
              />
            </div>
          </CardContent>
          <CardFooter className="border-t px-6 py-4">
            <Button onClick={handleSave} disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Configuration
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
