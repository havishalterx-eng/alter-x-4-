import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { MessageSquare, Calendar, Workflow, Folder, Terminal, Loader2 } from "lucide-react"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { type ConversationType } from "@/api/types"

function getIconForType(type: ConversationType) {
  switch (type) {
    case "workflow_builder": return <Workflow className="h-4 w-4" />
    case "project_builder": return <Folder className="h-4 w-4" />
    case "run_investigation": return <Terminal className="h-4 w-4" />
    default: return <MessageSquare className="h-4 w-4" />
  }
}

export function ConversationsList() {
  const { data: conversations, isLoading } = useQuery({
    queryKey: queryKeys.conversations.list(),
    queryFn: () => api.getConversations(),
  })

  return (
    <div className="flex h-full flex-col">
      <PageHeader 
        title="Conversations" 
        description="Your past interactions with AlterX."
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : conversations?.length === 0 ? (
            <div className="text-center p-8 border border-border border-dashed rounded-xl bg-surface-base">
              <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-foreground">No conversations yet.</p>
              <p className="text-sm text-muted-foreground mt-1">Go home to start a new chat.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {conversations?.map((conv) => (
                <Link
                  key={conv.id}
                  to={`/app/conversations/${conv.id}`}
                  className="flex items-start gap-4 p-4 rounded-xl border border-border bg-surface-base hover:border-primary/50 hover:bg-surface-raised transition-all"
                >
                  <div className="h-10 w-10 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-primary mt-1">
                    {getIconForType(conv.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h3 className="text-sm font-medium text-foreground truncate">
                        {conv.title}
                      </h3>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                        <Calendar className="h-3 w-3" />
                        {new Date(conv.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-1">
                      {conv.preview || "No preview available."}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
