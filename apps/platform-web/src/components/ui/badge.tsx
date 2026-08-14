import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-background hover:bg-primary-hover",
        secondary:
          "border-transparent bg-surface-hover text-text-primary hover:bg-border",
        outline: "text-text-primary",
        success:
          "border-transparent bg-success/15 text-success hover:bg-success/25",
        warning:
          "border-transparent bg-warning/15 text-warning hover:bg-warning/25",
        danger:
          "border-transparent bg-danger/15 text-danger hover:bg-danger/25",
        info: "border-transparent bg-info/15 text-info hover:bg-info/25",
        neutral: "border-transparent bg-surface-raised text-text-secondary hover:bg-surface-hover",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
