import { Button } from "@/components/ui/button"

interface StructuredArtifactMessageProps {
  title: string
  subtitle?: string
  content: React.ReactNode
  primaryActionLabel?: string
  onPrimaryAction?: () => void
  secondaryActionLabel?: string
  onSecondaryAction?: () => void
}

export function StructuredArtifactMessage({
  title,
  subtitle,
  content,
  primaryActionLabel,
  onPrimaryAction,
  secondaryActionLabel,
  onSecondaryAction,
}: StructuredArtifactMessageProps) {
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-surface-raised">
      <div className="border-b border-border bg-surface-hover/50 px-4 py-3">
        <h4 className="font-medium text-foreground">{title}</h4>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="p-4 text-sm text-foreground/90">{content}</div>
      {(primaryActionLabel || secondaryActionLabel) && (
        <div className="flex gap-2 border-t border-border bg-surface-hover/30 px-4 py-3">
          {primaryActionLabel && (
            <Button size="sm" variant="primary" onClick={onPrimaryAction}>
              {primaryActionLabel}
            </Button>
          )}
          {secondaryActionLabel && (
            <Button size="sm" variant="outline" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
