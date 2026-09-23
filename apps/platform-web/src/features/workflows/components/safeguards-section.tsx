import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Lock, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import type { WorkflowSafeguards } from "@/api/types"
import { ApiHttpError } from "@/api/http"
import { Button } from "@/components/ui/button"

type Additions = WorkflowSafeguards["additions"]

const SAFEGUARDS = [
  {
    key: "containsPii" as const,
    title: "Handles personal data",
    description: "Delivered output is checked before it leaves Alter.",
    workspaceKey: "containsPii" as const,
  },
  {
    key: "approveExternalActions" as const,
    title: "Approve external actions",
    description: "A person approves each step that sends or changes something outside Alter.",
    workspaceKey: "approveExternalActions" as const,
  },
  {
    key: "customerVisible" as const,
    title: "Output goes to a customer",
    description: "Anything delivered is checked, and a person approves it first.",
    workspaceKey: undefined,
  },
]

/**
 * What this workflow's runs are held to, and what this workflow adds.
 *
 * A workspace owner sets rules for every workflow in the workspace; a workflow
 * can add to them and never switch one off, so a rule the workspace requires
 * is shown on and locked. The saved value is read fresh on every plan, so this
 * is what the next run will actually use.
 */
export function SafeguardsSection({ workflowId }: { workflowId: string }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = React.useState<Additions | undefined>()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.workflows.safeguards(workflowId),
    queryFn: () => api.getWorkflowSafeguards(workflowId),
  })

  const save = useMutation({
    mutationFn: (additions: Additions) =>
      api.updateWorkflowSafeguards(workflowId, additions, data?.etag),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.workflows.safeguards(workflowId), saved)
      setDraft(undefined)
      toast.success("Safeguards saved")
    },
    onError: async (error) => {
      // 412: the workspace's rules or this workflow's additions changed since
      // they were read. Show what is there now rather than overwriting it.
      if (error instanceof ApiHttpError && error.status === 412) {
        await refetch()
        setDraft(undefined)
        toast.error("Safeguards changed while you were editing. Reloaded them.")
        return
      }
      toast.error("Could not save safeguards")
    },
  })

  if (isLoading) return null
  if (isError || !data) {
    return (
      <Section>
        <div className="flex items-center justify-between p-6">
          <p className="text-sm text-muted-foreground">Safeguards could not be loaded.</p>
          <Button variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      </Section>
    )
  }

  const additions = draft ?? data.additions
  const dirty = draft !== undefined && SAFEGUARDS.some(({ key }) => draft[key] !== data.additions[key])

  return (
    <Section>
      <div className="space-y-4 p-6">
        {SAFEGUARDS.map(({ key, title, description, workspaceKey }) => {
          const requiredByWorkspace = workspaceKey !== undefined && data.workspace[workspaceKey]
          const on = requiredByWorkspace || additions[key]
          return (
            <label key={key} className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={on}
                disabled={requiredByWorkspace || save.isPending}
                aria-label={title}
                onChange={(event) =>
                  setDraft({ ...additions, [key]: event.target.checked })
                }
              />
              <div>
                <p className="flex items-center gap-2 font-medium">
                  {title}
                  {requiredByWorkspace && (
                    <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                      <Lock className="h-3 w-3" /> Required by this workspace
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
            </label>
          )
        })}
      </div>
      <div className="flex items-center justify-between border-t border-border px-6 py-4">
        <p className="text-sm text-muted-foreground">
          Every run of this workflow uses these. A rule the workspace requires cannot be turned off
          here.
        </p>
        <Button
          variant="primary"
          disabled={!dirty || save.isPending}
          onClick={() => draft && save.mutate(draft)}
        >
          Save safeguards
        </Button>
      </div>
    </Section>
  )
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-raised">
      <div className="flex items-center gap-2 border-b border-border bg-surface px-4 py-3 font-medium">
        <ShieldCheck className="h-4 w-4" />
        Safeguards
      </div>
      {children}
    </div>
  )
}
