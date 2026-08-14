import { Badge } from "@/components/ui/badge"


interface StatusBadgeProps {
  status: string
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  let variant: "default" | "secondary" | "outline" | "success" | "warning" | "danger" | "info" | "neutral" = "default"
  let label: string = status

  switch (status) {
    case "active":
    case "completed":
      variant = "success"
      label = status === "active" ? "Active" : "Completed"
      break
    case "draft":
    case "queued":
      variant = "neutral"
      label = status === "draft" ? "Draft" : "Queued"
      break
    case "paused":
    case "waiting":
      variant = "warning"
      label = status === "paused" ? "Paused" : "Waiting"
      break
    case "failed":
    case "degraded":
      variant = "danger"
      label = status === "failed" ? "Failed" : "Degraded"
      break
    case "running":
      variant = "info"
      label = "Running"
      break
    case "archived":
      variant = "neutral"
      label = "Archived"
      break
  }

  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  )
}
