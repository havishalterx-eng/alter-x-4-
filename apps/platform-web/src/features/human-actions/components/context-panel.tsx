import { type HumanAction } from "@/api/types"
import { Info, AlertTriangle, ShieldCheck } from "lucide-react"

export function ContextPanel({ action }: { action: HumanAction }) {
  const { context } = action

  if (!context) return null

  return (
    <div className="space-y-6">
      {context.summary && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-text-primary">Summary</h4>
          <div className="rounded-lg bg-surface-hover p-4 text-sm text-text-secondary">
            {context.summary}
          </div>
        </div>
      )}

      {context.reason && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-text-primary">Trigger Reason</h4>
          <div className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/5 p-4 text-sm text-text-secondary">
            <Info className="mt-0.5 h-4 w-4 text-warning flex-shrink-0" />
            <span>{context.reason}</span>
          </div>
        </div>
      )}

      {context.options && context.options.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-text-primary">Available Options</h4>
          <ul className="space-y-2">
            {context.options.map(opt => (
              <li key={opt.id} className="rounded-lg border border-border p-3 text-sm">
                <span className="font-medium">{opt.label}</span>
                {opt.value && <span className="ml-2 text-text-muted font-mono">{opt.value}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(context.recommendation || context.risk) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {context.recommendation && (
            <div className="rounded-lg border border-success/20 bg-success/5 p-4">
              <div className="mb-1 flex items-center gap-1.5 text-sm font-medium text-success">
                <ShieldCheck className="h-4 w-4" /> Recommendation
              </div>
              <div className="text-sm text-text-secondary">{context.recommendation}</div>
              {context.confidence !== undefined && (
                <div className="mt-2 text-xs text-text-muted">
                  Confidence: {Math.round(context.confidence * 100)}%
                </div>
              )}
            </div>
          )}
          
          {context.risk && (
            <div className="rounded-lg border border-danger/20 bg-danger/5 p-4">
              <div className="mb-1 flex items-center gap-1.5 text-sm font-medium text-danger">
                <AlertTriangle className="h-4 w-4" /> Risk Assessment
              </div>
              <div className="text-sm text-text-secondary">{context.risk}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
