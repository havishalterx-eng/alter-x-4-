import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatCompactNumber } from "@/lib/formatters"
import { Download, Star } from "lucide-react"

export function MarketplaceHomePage() {
  const navigate = useNavigate()
  const { data: listings, isLoading } = useQuery({
    queryKey: queryKeys.marketplace.listings(),
    queryFn: () => api.marketplace.listings.list()
  })

  if (isLoading) return <div className="animate-pulse">Loading marketplace...</div>

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Discover</h1>
        <p className="mt-2 text-muted-foreground">Workflows and project templates built for AlterX.</p>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Featured Templates</h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {listings?.slice(0, 3).map(listing => (
            <Card key={listing.id} className="flex flex-col cursor-pointer ax-card-hover transition-all" onClick={() => navigate(`/app/marketplace/listings/${listing.id}`)}>
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
      </div>
    </div>
  )
}
