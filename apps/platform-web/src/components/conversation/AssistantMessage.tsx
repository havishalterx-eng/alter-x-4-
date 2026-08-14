import { Bot } from "lucide-react"

export function AssistantMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Bot className="h-5 w-5" />
      </div>
      <div className="flex-1 space-y-2 pt-1 text-sm text-foreground/90">
        {children}
      </div>
    </div>
  )
}
