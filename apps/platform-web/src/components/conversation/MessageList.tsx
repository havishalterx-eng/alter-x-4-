import { type ChatMessage } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Database } from "lucide-react"
import { UserMessage } from "./UserMessage"
import { AssistantMessage } from "./AssistantMessage"

interface MessageListProps {
  messages: ChatMessage[]
  renderCustomMessage?: (msg: ChatMessage) => React.ReactNode
}

export function MessageList({ messages, renderCustomMessage }: MessageListProps) {
  return (
    <div className="flex flex-col gap-6">
      {messages.map((msg) => {
        if (msg.role === "user") {
          return <UserMessage key={msg.id}>{msg.content}</UserMessage>
        }

        return (
          <AssistantMessage key={msg.id}>
            {msg.type === "text" && (
              <div className="space-y-3">
                <p className="whitespace-pre-wrap">{msg.content}</p>
                {msg.data?.provenance && msg.data.provenance.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
                    <span className="text-xs text-muted-foreground mt-0.5">Sources:</span>
                    {msg.data.provenance.map((prov: any, idx: number) => (
                      <Badge key={idx} variant="secondary" className="text-xs font-normal bg-muted/50 flex items-center gap-1">
                        <Database className="h-3 w-3" />
                        {prov.sourceName} / {prov.documentName}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
            {msg.type !== "text" && renderCustomMessage && renderCustomMessage(msg)}
          </AssistantMessage>
        )
      })}
    </div>
  )
}
