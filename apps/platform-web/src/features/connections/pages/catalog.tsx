import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { Plus, Search, Puzzle } from "lucide-react"

import { PageHeader } from "@/components/common/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { ConnectFlowDialog } from "../components/connect-flow-dialog"
import { type IntegrationDefinition } from "@/api/types"
import { ConnectionVector } from "@/components/vectors/ConnectionVector"

export function IntegrationCatalogPage() {
  const navigate = useNavigate()
  const [search, setSearch] = React.useState("")
  const [selectedIntegration, setSelectedIntegration] = React.useState<IntegrationDefinition | null>(null)
  
  const { data: integrations, isLoading: loadingIntegrations } = useQuery({
    queryKey: queryKeys.integrations.list,
    queryFn: () => api.getIntegrationCatalog()
  })

  const { data: connections, isLoading: loadingConnections } = useQuery({
    queryKey: queryKeys.connections.list,
    queryFn: () => api.getConnections()
  })

  const filteredIntegrations = React.useMemo(() => {
    if (!integrations) return []
    if (!search) return integrations
    const lower = search.toLowerCase()
    return integrations.filter(i => 
      i.name.toLowerCase().includes(lower) || 
      i.category.toLowerCase().includes(lower)
    )
  }, [integrations, search])

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="relative">
        <PageHeader 
          title="Integrations & Connections"
          description="Connect external services to use their actions and triggers in workflows."
        />
        <div className="hidden md:block absolute right-8 top-2 w-[260px] h-16 opacity-70 pointer-events-none">
          <ConnectionVector />
        </div>
      </div>

      <div className="mt-8 space-y-8">
        {/* Active Connections Section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold tracking-tight">Active Connections</h2>
            <Button variant="outline" onClick={() => navigate("/app/settings/credentials")}>
              Manage Credentials
            </Button>
          </div>
          
          {loadingConnections ? (
            <div className="text-muted-foreground">Loading connections...</div>
          ) : connections && connections.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {connections.map(conn => (
                <Card 
                  key={conn.id} 
                  className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => navigate(`/app/connections/${conn.id}`)}
                >
                  <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0">
                    <div>
                      <CardTitle className="text-base">{conn.name}</CardTitle>
                      <CardDescription className="text-xs mt-1 truncate">
                        {integrations?.find(i => i.id === conn.integrationId)?.name || 'Unknown Integration'}
                      </CardDescription>
                    </div>
                    <Badge variant={
                      conn.status === 'connected' ? 'default' : 
                      conn.status === 'degraded' ? 'warning' : 'danger'
                    }>
                      {conn.status}
                    </Badge>
                  </CardHeader>
                </Card>
              ))}
            </div>
          ) : (
            <div className="p-8 border border-dashed rounded-lg text-center text-muted-foreground">
              No active connections yet.
            </div>
          )}
        </section>

        {/* Catalog Section */}
        <section>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <h2 className="text-xl font-semibold tracking-tight">Integration Catalog</h2>
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search integrations..." 
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          
          {loadingIntegrations ? (
            <div className="text-muted-foreground">Loading catalog...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredIntegrations.map(integration => (
                <Card key={integration.id} className="flex flex-col">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-muted rounded-md">
                        <Puzzle className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{integration.name}</CardTitle>
                        <Badge variant="secondary" className="mt-1">{integration.category}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1">
                    <p className="text-sm text-muted-foreground">{integration.description}</p>
                    <div className="mt-4 flex flex-wrap gap-1">
                      {integration.capabilities.map(cap => (
                        <span key={cap} className="text-xs px-2 py-1 bg-accent rounded-full text-accent-foreground">
                          {cap}
                        </span>
                      ))}
                    </div>
                  </CardContent>
                  <CardFooter className="border-t pt-4">
                    <Button 
                      className="w-full" 
                      onClick={() => setSelectedIntegration(integration)}
                    >
                      <Plus className="mr-2 h-4 w-4" /> Connect
                    </Button>
                  </CardFooter>
                </Card>
              ))}
              
              {filteredIntegrations.length === 0 && (
                <div className="col-span-full p-8 text-center text-muted-foreground">
                  No integrations found matching your search.
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <ConnectFlowDialog 
        integration={selectedIntegration} 
        open={!!selectedIntegration} 
        onOpenChange={(o) => !o && setSelectedIntegration(null)} 
      />
    </div>
  )
}
