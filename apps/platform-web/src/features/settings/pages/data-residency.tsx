import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Globe2, Loader2, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/api/client"
import { ApiHttpError } from "@/api/http"
import { queryKeys } from "@/api/query-keys"
import type { TenantDataResidency } from "@/api/types"
import { PermissionDenied } from "@/components/feedback/permission-denied"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

type Draft = {
  pinned: boolean
  codes: string
  legalBasis: string
}

function draftFrom(dataResidency: TenantDataResidency | null): Draft {
  return {
    pinned: dataResidency !== null,
    codes: dataResidency?.allowed.join(", ") ?? "",
    legalBasis: dataResidency?.legalBasis ?? "",
  }
}

function normalizeCodes(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((code) => code.trim()).filter(Boolean))]
}

export function DataResidencySettings() {
  const queryClient = useQueryClient()
  const [draft, setDraft] = React.useState<Draft | undefined>()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.settings.dataResidency,
    queryFn: () => api.getTenantDataResidencySettings(),
  })

  React.useEffect(() => {
    if (data) setDraft(draftFrom(data.dataResidency))
  }, [data])

  const save = useMutation({
    mutationFn: (next: TenantDataResidency | null) => {
      if (!data) throw new Error("Tenant data residency is not loaded")
      return api.updateTenantDataResidencySettings(data.tenantId, next, data.etag)
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.settings.dataResidency, saved)
      toast.success("Data residency saved")
    },
    onError: async (error) => {
      if (error instanceof ApiHttpError && error.status === 412) {
        await refetch()
        toast.error(
          "Data residency changed while you were editing. Reloaded the latest settings.",
        )
        return
      }
      toast.error(error instanceof Error ? error.message : "Could not save data residency")
    },
  })

  if (isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
      </div>
    )
  }

  if (isError || !data || !draft) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6">
        <p className="text-sm text-text-muted">Data-residency settings could not be loaded.</p>
        <Button className="mt-4" variant="outline" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  if (data.role !== "owner") {
    return <PermissionDenied requiredPermission="tenant owner" />
  }

  const normalizedCodes = normalizeCodes(draft.codes)
  const codeError = draft.pinned && (normalizedCodes.length === 0 || normalizedCodes.length > 32)
  const next: TenantDataResidency | null = draft.pinned
    ? {
        allowed: normalizedCodes,
        ...(draft.legalBasis.trim() ? { legalBasis: draft.legalBasis.trim() } : {}),
      }
    : null
  const current = JSON.stringify(data.dataResidency)
  const changed = JSON.stringify(next) !== current

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-text-primary">Data residency</h1>
        <p className="mt-2 text-text-secondary">
          Control where {data.tenantName}&apos;s workflow data may be processed.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-6 py-5">
          <Globe2 className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-medium text-text-primary">Processing locations</h2>
        </div>
        <div className="space-y-6 px-6 py-6">
          <label className="flex items-start gap-3">
            <input
              type="radio"
              name="residency-mode"
              aria-label="No residency pin"
              checked={!draft.pinned}
              disabled={save.isPending}
              onChange={() => setDraft({ ...draft, pinned: false })}
            />
            <span>
              <span className="block font-medium text-text-primary">No residency pin</span>
              <span className="block text-sm text-text-muted">
                Let Alter select from every eligible processing location.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="radio"
              name="residency-mode"
              aria-label="Restrict processing locations"
              checked={draft.pinned}
              disabled={save.isPending}
              onChange={() => setDraft({ ...draft, pinned: true })}
            />
            <span>
              <span className="block font-medium text-text-primary">Restrict processing locations</span>
              <span className="block text-sm text-text-muted">
                Plans may use only resources that declare one of the allowed residency codes.
              </span>
            </span>
          </label>

          {draft.pinned && (
            <div className="grid gap-5 border-l-2 border-primary/20 pl-6">
              <div className="space-y-2">
                <label htmlFor="residency-codes" className="text-sm font-medium text-text-primary">
                  Allowed residency codes
                </label>
                <Input
                  id="residency-codes"
                  value={draft.codes}
                  error={codeError}
                  disabled={save.isPending}
                  placeholder="IN, EU"
                  onChange={(event) => setDraft({ ...draft, codes: event.target.value })}
                />
                <p className={codeError ? "text-sm text-danger" : "text-sm text-text-muted"}>
                  Enter 1–32 comma-separated capability codes. Codes are matched exactly.
                </p>
              </div>
              <div className="space-y-2">
                <label htmlFor="residency-legal-basis" className="text-sm font-medium text-text-primary">
                  Legal basis
                </label>
                <Textarea
                  id="residency-legal-basis"
                  value={draft.legalBasis}
                  disabled={save.isPending}
                  placeholder="Optional policy, contract, or regulatory basis"
                  onChange={(event) => setDraft({ ...draft, legalBasis: event.target.value })}
                />
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border px-6 py-4">
          <p className="flex items-start gap-2 text-sm text-text-muted">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            A plan is blocked when no eligible resource satisfies this pin.
          </p>
          <Button
            disabled={!changed || codeError || save.isPending || !data.etag}
            loading={save.isPending}
            onClick={() => save.mutate(next)}
          >
            Save data residency
          </Button>
        </div>
      </div>
    </div>
  )
}
