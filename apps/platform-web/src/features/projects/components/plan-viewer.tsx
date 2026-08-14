import { CheckCircle2, Circle, CircleDashed } from "lucide-react"
import { type ProjectPlan } from "@/api/types"
import { cn } from "@/lib/utils"

interface PlanViewerProps {
  plan: ProjectPlan
}

export function PlanViewer({ plan }: PlanViewerProps) {
  return (
    <div className="space-y-6">
      {plan.phases.map((phase, i) => (
        <div key={phase.id} className="rounded-xl border border-border bg-surface-raised overflow-hidden">
          <div className="border-b border-border bg-surface-hover/30 px-5 py-4">
            <h3 className="font-semibold text-foreground">
              {i + 1}. {phase.title}
            </h3>
            {phase.description && (
              <p className="mt-1 text-sm text-muted-foreground">{phase.description}</p>
            )}
          </div>
          <div className="p-5">
            <ul className="space-y-4 relative">
              {phase.tasks.map((task, j) => (
                <li key={task.id} className="relative flex gap-4">
                  {j !== phase.tasks.length - 1 && (
                    <div className="absolute left-[11px] top-6 bottom-[-16px] w-px bg-border" />
                  )}
                  <div className="relative z-10 mt-0.5 bg-surface-raised">
                    {task.status === "done" && <CheckCircle2 className="h-6 w-6 text-emerald-500" />}
                    {task.status === "in_progress" && <CircleDashed className="h-6 w-6 text-primary animate-spin-slow" />}
                    {task.status === "pending" && <Circle className="h-6 w-6 text-muted-foreground" />}
                  </div>
                  <div>
                    <p className={cn("font-medium", task.status === "pending" && "text-muted-foreground")}>
                      {task.title}
                    </p>
                    {task.status === "in_progress" && <p className="text-xs text-primary mt-1">In progress</p>}
                    {task.status === "done" && <p className="text-xs text-emerald-500 mt-1">Completed</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  )
}
