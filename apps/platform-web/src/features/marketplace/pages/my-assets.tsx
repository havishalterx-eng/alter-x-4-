import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Play, Store } from "lucide-react"

export function MyAssetsPage() {
  const navigate = useNavigate()
  
  const { data: assets, isLoading } = useQuery({
    queryKey: queryKeys.marketplace.myAssets,
    queryFn: () => api.marketplace.myAssets.list()
  })

  // We need to fetch the listings info to show details about installed assets
  const { data: listings } = useQuery({
    queryKey: queryKeys.marketplace.listings(),
    queryFn: () => api.marketplace.listings.list(),
  })

  return (
    <div className="space-y-8">
      <PageHeader 
        title="My Assets"
        description="Templates and packs you've installed from the marketplace."
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Installed On</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground animate-pulse">Loading assets...</TableCell>
                </TableRow>
              ) : assets?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                    <p>No assets installed yet.</p>
                    <Button variant="outline" className="mt-4" onClick={() => navigate("/app/marketplace")}>
                      Browse Marketplace
                    </Button>
                  </TableCell>
                </TableRow>
              ) : (
                assets?.map((asset) => {
                  const listing = listings?.find(l => l.id === asset.listingId)
                  return (
                    <TableRow key={asset.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-3 cursor-pointer hover:underline" onClick={() => navigate(`/app/marketplace/listings/${asset.listingId}`)}>
                          <div className="h-8 w-8 rounded bg-surface-hover flex items-center justify-center">
                            <Store className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div>
                            <div>{listing?.title || asset.listingId}</div>
                            {listing?.seller && <div className="text-xs text-muted-foreground font-normal">By {listing.seller.displayName}</div>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">{listing?.assetType.replace("_", " ") || "Unknown"}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{asset.installedVersion || "latest"}</TableCell>
                      <TableCell className="text-sm">{new Date(asset.installedAt).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        {asset.createdWorkflowId && (
                          <Button variant="ghost" size="sm" onClick={() => navigate(`/app/workflows/${asset.createdWorkflowId}`)}>
                            <Play className="mr-2 h-4 w-4" /> Open
                          </Button>
                        )}
                        {!asset.createdWorkflowId && asset.createdProjectId && (
                          <Button variant="ghost" size="sm" onClick={() => navigate(`/app/projects/${asset.createdProjectId}`)}>
                            <Play className="mr-2 h-4 w-4" /> Open
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
