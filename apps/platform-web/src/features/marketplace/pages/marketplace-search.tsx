import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { formatCurrency, formatCompactNumber } from "@/lib/formatters"
import { Download, Search, Star } from "lucide-react"

export function MarketplaceSearchPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState("")

  const { data: listings, isLoading } = useQuery({
    queryKey: queryKeys.marketplace.listings({ q: search }),
    queryFn: () => api.marketplace.listings.list({ q: search })
  })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Browse All</h1>
        <p className="mt-2 text-muted-foreground">Search and filter the marketplace.</p>
      </div>

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates, workflows, projects..." 
          className="pl-10 py-6 text-base"
        />
      </div>

      {isLoading ? (
        <div className="animate-pulse text-muted-foreground">Searching...</div>
      ) : listings?.length === 0 ? (
        <div className="text-center p-12 border rounded-lg border-dashed">
          <p className="text-muted-foreground">No listings found matching "{search}"</p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {listings?.map(listing => (
            <Card key={listing.id} className="flex flex-col cursor-pointer hover:border-primary/50 transition-colors" onClick={() => navigate(`/app/marketplace/listings/${listing.id}`)}>
              <CardHeader>
                <div className="flex justify-between items-start mb-2">
                  <Badge variant="secondary" className="capitalize">{listing.category}</Badge>
                  <div className="font-semibold text-sm">
                    {listing.pricing.type === "free" ? "Free" : formatCurrency(listing.pricing.price, listing.pricing.currency)}
                  </div>
                </div>
                <CardTitle className="text-lg leading-tight">{listing.title}</CardTitle>
                <CardDescription className="line-clamp-2 mt-2">{listing.shortDescription}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto">
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Star className="h-3 w-3 fill-primary text-primary" />
                    {listing.rating} ({listing.reviewCount})
                  </span>
                  <span className="flex items-center gap-1">
                    <Download className="h-3 w-3" />
                    {formatCompactNumber(listing.installCount || 0)} installs
                  </span>
                </div>
              </CardContent>
              <CardFooter className="pt-0 text-xs text-muted-foreground border-t border-border mt-4 p-4">
                By {listing.seller.displayName}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
