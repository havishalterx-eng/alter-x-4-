
import { SearchX } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useNavigate } from "react-router-dom"

interface NotFoundProps {
  className?: string
}

export function NotFound({ className }: NotFoundProps) {
  const navigate = useNavigate()
  
  return (
    <div
      className={cn(
        "flex min-h-[400px] flex-col items-center justify-center p-8 text-center",
        className
      )}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-ax-surface-1 mb-6 border border-ax-border">
        <SearchX className="h-8 w-8 text-ax-text-muted" />
      </div>
      <h2 className="text-2xl font-semibold text-ax-text">Page Not Found</h2>
      <p className="mt-2 max-w-md text-ax-text-muted">
        The page you are looking for doesn't exist or has been moved.
      </p>
      <div className="mt-8">
        <Button variant="primary" onClick={() => navigate("/app/dashboard")}>
          Return to Dashboard
        </Button>
      </div>
    </div>
  )
}
