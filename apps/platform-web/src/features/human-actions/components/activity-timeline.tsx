import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { type HumanAction, type HumanAnnotation } from "@/api/types"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Send } from "lucide-react"

export function ActivityTimeline({ action }: { action: HumanAction }) {
  const queryClient = useQueryClient()
  const [annotation, setAnnotation] = React.useState("")

  const { data: history = [], isLoading } = useQuery({
    queryKey: queryKeys.humanActions.history(action.id),
    queryFn: () => api.getHumanActionHistory(action.type, action.id)
  })

  const annotateMutation = useMutation({
    mutationFn: () => api.addHumanAnnotation(action.type, action.id, annotation),
    onSuccess: () => {
      setAnnotation("")
      queryClient.invalidateQueries({ queryKey: queryKeys.humanActions.history(action.id) })
    }
  })

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {isLoading ? (
          <div className="h-20 animate-pulse rounded-lg bg-surface-hover" />
        ) : history.length === 0 ? (
          <p className="text-sm text-text-muted">No activity or comments yet.</p>
        ) : (
          history.map((item: HumanAnnotation) => (
            <div key={item.id} className="flex gap-4">
              <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <span className="text-xs font-medium text-primary">
                  {item.author.name.charAt(0)}
                </span>
              </div>
              <div className="flex-1 rounded-lg border border-border bg-surface p-4 text-sm shadow-sm">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-medium text-text-primary">{item.author.name}</span>
                  <span className="text-xs text-text-muted">
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="text-text-secondary">{item.text}</div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex gap-2">
        <Textarea 
          placeholder="Add a comment or note..."
          value={annotation}
          onChange={e => setAnnotation(e.target.value)}
          rows={2}
          className="min-h-[44px]"
        />
        <Button 
          size="icon" 
          variant="primary" 
          className="shrink-0 self-end"
          disabled={!annotation || annotateMutation.isPending}
          onClick={() => annotateMutation.mutate()}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
