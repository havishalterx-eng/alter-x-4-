import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { EyeOff } from "lucide-react"
import { isLiveApi } from "@/api/http"
import { Button } from "@/components/ui/button"
import {
  isLiveFeatureAvailable,
  liveFeatureNames,
  type LiveFeature,
} from "./live-feature-policy"

interface LiveFeatureGateProps {
  feature: LiveFeature
  children: ReactNode
  live?: boolean
}

export function LiveFeatureGate({
  feature,
  children,
  live = isLiveApi,
}: LiveFeatureGateProps) {
  if (isLiveFeatureAvailable(feature, live)) return <>{children}</>

  const name = liveFeatureNames[feature]
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center p-8 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-warning/10">
        <EyeOff className="h-8 w-8 text-warning" />
      </div>
      <h1 className="text-2xl font-semibold text-text-primary">
        {name} is not available in live mode
      </h1>
      <p className="mt-2 max-w-lg text-text-muted">
        Demo data is not shown when AlterX is connected to live services.
      </p>
      <p className="mt-1 max-w-lg text-sm text-text-muted">
        This area will return when its live backend integration is ready.
      </p>
      <Button className="mt-8" variant="secondary" asChild>
        <Link to="/app/home">Return home</Link>
      </Button>
    </div>
  )
}
