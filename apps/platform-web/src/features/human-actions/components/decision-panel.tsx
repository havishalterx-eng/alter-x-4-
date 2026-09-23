import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type HumanAction } from "@/api/types"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { CheckCircle, XCircle, Hand, Lock } from "lucide-react"

export function DecisionPanel({ action }: { action: HumanAction }) {
  const queryClient = useQueryClient()
  const currentUserId = useAuth((state) => state.user?.userId)
  const [comment, setComment] = React.useState("")
  
  const claimMutation = useMutation({
    mutationFn: () => api.claimHumanAction(action.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.humanActions.detail(action.id) })
    }
  })

  const approveMutation = useMutation({
    mutationFn: () => api.approveHumanAction(action.id, { comment }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.humanActions.detail(action.id) })
    }
  })

  const rejectMutation = useMutation({
    mutationFn: () => api.rejectHumanAction(action.id, { comment }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.humanActions.detail(action.id) })
    }
  })
  
  const answerMutation = useMutation({
    mutationFn: () => api.answerHumanAction(action.id, { comment }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.humanActions.detail(action.id) })
    }
  })

  const resolveMutation = useMutation({
    mutationFn: () => api.resolveHumanAction(action.id, { comment }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.humanActions.detail(action.id) })
    }
  })

  // Who holds a claimed action decides whether this person may act on it. The
  // signed-in user comes from the session; until it is known, a claimed action
  // is treated as somebody else's rather than as this person's.
  const isClaimedByOther =
    action.status === "claimed" && !sameUser(action.claimedBy?.id, currentUserId)
  const isResolved = action.status === "resolved"
  const isClosed = ["expired", "cancelled"].includes(action.status)

  if (isResolved) {
    return (
      <div className="rounded-xl border border-success/20 bg-success/5 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success/20">
            <CheckCircle className="h-5 w-5 text-success" />
          </div>
          <div>
            <h3 className="font-semibold text-text-primary">Resolved</h3>
            <p className="text-sm text-text-muted">
              By {action.resolvedBy?.name || "System"} on {action.resolvedAt ? new Date(action.resolvedAt).toLocaleString() : "Unknown"}
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (isClosed) {
    return (
      <div className="rounded-xl border border-border bg-surface-hover p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-active">
            <XCircle className="h-5 w-5 text-text-muted" />
          </div>
          <div>
            <h3 className="font-semibold text-text-primary">Action {action.status}</h3>
            <p className="text-sm text-text-muted">This action is no longer active.</p>
          </div>
        </div>
      </div>
    )
  }

  const isApproval = action.type === "approval"
  const needsClaim = !isApproval && action.status === "open"

  return (
    <div className="rounded-xl border border-border bg-surface shadow-sm">
      <div className="border-b border-border p-4 px-6 font-medium">Action Required</div>
      
      <div className="p-6">
        {needsClaim ? (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Hand className="h-6 w-6 text-primary" />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-text-primary">Claim this action</h3>
            <p className="mb-6 text-sm text-text-muted">
              Claim this action to lock it for your review. Other users will see that you are working on it.
            </p>
            <Button 
              className="w-full" 
              onClick={() => claimMutation.mutate()}
              loading={claimMutation.isPending}
            >
              Claim Action
            </Button>
          </div>
        ) : isClaimedByOther && !isApproval ? (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warning/10">
              <Lock className="h-6 w-6 text-warning" />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-text-primary">Action Locked</h3>
            <p className="text-sm text-text-muted">
              This action is currently claimed by <strong>{action.claimedBy?.name}</strong>.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {!isApproval && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-muted">You have claimed this action.</span>
              </div>
            )}
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Comments (optional)</label>
              <Textarea 
                placeholder="Add context to your decision..."
                value={comment}
                onChange={(e: any) => setComment(e.target.value)}
                rows={3}
              />
            </div>

            <div className="flex gap-3 pt-2">
              {action.type === "approval" ? (
                <>
                  <Button 
                    className="flex-1" 
                    variant="danger" 
                    onClick={() => rejectMutation.mutate()}
                    loading={rejectMutation.isPending}
                  >
                    Reject
                  </Button>
                  <Button 
                    className="flex-1" 
                    variant="primary" 
                    onClick={() => approveMutation.mutate()}
                    loading={approveMutation.isPending}
                  >
                    Approve
                  </Button>
                </>
              ) : action.type === "clarification" ? (
                <Button 
                  className="w-full" 
                  variant="primary" 
                  onClick={() => answerMutation.mutate()}
                  loading={answerMutation.isPending}
                  disabled={!comment}
                >
                  Provide Answer
                </Button>
              ) : (
                <Button 
                  className="w-full" 
                  variant="primary" 
                  onClick={() => resolveMutation.mutate()}
                  loading={resolveMutation.isPending}
                >
                  Resolve Escalation
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


/**
 * Whether two user ids name the same person.
 *
 * The engine returns the bare UUID an action was assigned to; the session may
 * carry the same id with its `usr_` prefix.
 */
function sameUser(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false
  const bare = (value: string) => (value.startsWith("usr_") ? value.slice("usr_".length) : value)
  return bare(left) === bare(right)
}
