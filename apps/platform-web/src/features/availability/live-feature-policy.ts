import { isLiveApi } from "@/api/http"

export type LiveFeature =
  | "admin-console"
  | "benchmarks"
  | "discovery"
  | "notifications"

export const liveFeatureNames: Record<LiveFeature, string> = {
  "admin-console": "Admin Console",
  benchmarks: "Benchmarks",
  discovery: "Discovery",
  notifications: "Notifications",
}

const unfinishedLiveFeatures = new Set<LiveFeature>([
  "admin-console",
  "benchmarks",
  "discovery",
  "notifications",
])

export function isLiveFeatureAvailable(feature: LiveFeature, live = isLiveApi) {
  return !live || !unfinishedLiveFeatures.has(feature)
}
