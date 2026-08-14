import { NavLink, Outlet, useNavigate } from "react-router-dom"
import { Store } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export function MarketplaceLayout() {
  const navigate = useNavigate()

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-border bg-surface px-8 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 font-bold text-lg text-primary mr-4">
            <Store className="h-6 w-6" />
            Marketplace
          </div>
          <nav className="flex items-center gap-1">
            <NavLink
              to="/app/marketplace"
              end
              className={({ isActive }) =>
                cn(
                  "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                  isActive ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-surface-hover"
                )
              }
            >
              Discover
            </NavLink>
            <NavLink
              to="/app/marketplace/search"
              className={({ isActive }) =>
                cn(
                  "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                  isActive ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-surface-hover"
                )
              }
            >
              Browse All
            </NavLink>
            <NavLink
              to="/app/marketplace/my-assets"
              className={({ isActive }) =>
                cn(
                  "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                  isActive ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-surface-hover"
                )
              }
            >
              My Assets
            </NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate("/app/seller")}>
            Seller Console
          </Button>
        </div>
      </div>
      <div className="flex-1 p-8 max-w-6xl w-full mx-auto">
        <Outlet />
      </div>
    </div>
  )
}
