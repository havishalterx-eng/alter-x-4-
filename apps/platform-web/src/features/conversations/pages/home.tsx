import { useNavigate } from "react-router-dom"
import { useMutation } from "@tanstack/react-query"
import { Bot, ArrowRight, Zap, Folder, CheckSquare } from "lucide-react"
import { Composer } from "@/components/conversation/Composer"
import { api } from "@/api/client"
import { cn } from "@/lib/utils"

const INTENT_SUGGESTIONS = [
  { label: "Create a new workflow for support", icon: Zap },
  { label: "Build a customer portal project", icon: Folder },
  { label: "Investigate why a run failed", icon: CheckSquare },
  { label: "Summarize recent activity", icon: Bot },
]

export function Home() {
  const navigate = useNavigate()

  const startConversation = useMutation({
    mutationFn: async (message: string) => {
      // Create conversation
      const conv = await api.createConversation({
        type: "general",
        title: message.slice(0, 30) + (message.length > 30 ? "..." : "")
      })
      // Send initial message
      await api.sendMessage(conv.id, { content: message })
      return conv
    },
    onSuccess: (data) => {
      navigate(`/app/conversations/${data.id}`)
    }
  })

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        
        <div className="w-full max-w-2xl flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
            <Bot className="h-8 w-8 text-primary" />
          </div>
          
          <h1 className="text-3xl font-semibold mb-2 text-center text-foreground">
            What do you want to build today?
          </h1>
          <p className="text-muted-foreground mb-8 text-center max-w-md">
            I'm AlterX. I can help you orchestrate agents, automate workflows, and investigate run failures.
          </p>

          <div className="w-full mb-8">
            <Composer 
              onSend={(msg) => startConversation.mutate(msg)} 
              loading={startConversation.isPending}
              placeholder="Describe what you want to achieve..."
            />
          </div>

          <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
            {INTENT_SUGGESTIONS.map((suggestion, i) => (
              <button
                key={i}
                onClick={() => startConversation.mutate(suggestion.label)}
                disabled={startConversation.isPending}
                className={cn(
                  "group flex items-center gap-3 p-3 rounded-xl border border-border bg-surface-base text-left transition-all",
                  "hover:border-primary/50 hover:bg-surface-raised",
                  startConversation.isPending && "opacity-50 pointer-events-none"
                )}
              >
                <div className="h-8 w-8 rounded-lg bg-surface-raised flex items-center justify-center shrink-0">
                  <suggestion.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <span className="text-sm font-medium flex-1">{suggestion.label}</span>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 -translate-x-2 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
              </button>
            ))}
          </div>

        </div>

      </div>
    </div>
  )
}
