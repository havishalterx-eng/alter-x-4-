import * as React from "react"
import { Send, Paperclip } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ComposerProps {
  onSend: (message: string) => void
  placeholder?: string
  disabled?: boolean
  loading?: boolean
}

export function Composer({ onSend, placeholder = "Describe a workflow...", disabled, loading }: ComposerProps) {
  const [value, setValue] = React.useState("")
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (value.trim() && !disabled && !loading) {
        onSend(value.trim())
        setValue("")
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto"
        }
      }
    }
  }

  return (
    <div className={cn(
      "flex items-end gap-2 p-2 rounded-xl border border-border bg-surface-raised transition-colors focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/50",
      (disabled || loading) && "opacity-50 pointer-events-none"
    )}>
      <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground" disabled>
        <Paperclip className="h-4 w-4" />
      </Button>
      
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || loading}
        className="w-full max-h-[200px] min-h-[40px] resize-none bg-transparent py-2.5 text-sm outline-none placeholder:text-muted-foreground"
        rows={1}
      />

      <Button
        variant={value.trim() ? "primary" : "ghost"}
        size="icon"
        className={cn("shrink-0", !value.trim() && "text-muted-foreground")}
        onClick={() => {
          if (value.trim()) {
            onSend(value.trim())
            setValue("")
            if (textareaRef.current) {
              textareaRef.current.style.height = "auto"
            }
          }
        }}
        disabled={!value.trim() || disabled || loading}
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  )
}
