import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
  leadingIcon?: React.ReactNode
  trailingAction?: React.ReactNode
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, leadingIcon, trailingAction, ...props }, ref) => {
    return (
      <div className="relative flex items-center w-full">
        {leadingIcon && (
          <div className="absolute left-3 text-text-muted">
            {leadingIcon}
          </div>
        )}
        <input
          type={type}
          className={cn(
            "flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
            leadingIcon && "pl-10",
            trailingAction && "pr-10",
            error && "border-danger focus-visible:ring-danger",
            className
          )}
          ref={ref}
          {...props}
        />
        {trailingAction && (
          <div className="absolute right-3">
            {trailingAction}
          </div>
        )}
      </div>
    )
  }
)
Input.displayName = "Input"

export { Input }
