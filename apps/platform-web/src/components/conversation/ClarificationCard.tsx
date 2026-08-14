import { Button } from "@/components/ui/button"

interface ClarificationCardProps {
  question: string
  options: string[]
  onSelect: (option: string) => void
}

export function ClarificationCard({ question, options, onSelect }: ClarificationCardProps) {
  return (
    <div className="mt-2 space-y-3 rounded-lg border border-border bg-surface-raised p-4">
      <p className="text-sm font-medium">{question}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <Button
            key={opt}
            variant="outline"
            size="sm"
            onClick={() => onSelect(opt)}
            className="h-8"
          >
            {opt}
          </Button>
        ))}
      </div>
    </div>
  )
}
