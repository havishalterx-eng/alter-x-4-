import { ArrowUpRight } from "lucide-react"

interface SuggestionCardProps {
  title: string
  onClick: () => void
}

export function SuggestionCard({ title, onClick }: SuggestionCardProps) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col justify-between gap-4 rounded-xl border border-border bg-surface-raised p-4 text-left transition-colors hover:border-primary/50 hover:bg-surface-hover"
    >
      <span className="text-sm font-medium text-foreground/90">{title}</span>
      <div className="flex w-full justify-end">
        <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-50 transition-opacity group-hover:opacity-100 group-hover:text-primary" />
      </div>
    </button>
  )
}
