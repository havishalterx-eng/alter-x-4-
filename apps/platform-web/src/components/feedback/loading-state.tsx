
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface LoadingStateProps {
  message?: string
  className?: string
  fullScreen?: boolean
}

export function LoadingState({ message = "Loading...", className, fullScreen }: LoadingStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-8 text-text-muted",
        fullScreen && "min-h-[400px] h-full",
        className
      )}
    >
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      {message && <p className="mt-4 text-sm">{message}</p>}
    </div>
  )
}
