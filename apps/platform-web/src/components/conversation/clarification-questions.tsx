import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2 } from "lucide-react"

export interface ClarificationQuestion {
  /** What the answer is keyed by when it goes back: the question itself for a
   * workflow plan, the clarification's own id for a project. */
  id: string
  question: string
  required?: boolean
}

interface ClarificationQuestionsProps {
  questions: readonly ClarificationQuestion[]
  onSubmit: (answers: Record<string, string>) => void
  pending?: boolean
  submitLabel?: string
}

/**
 * The planner's own questions, answered in free text. Nothing behind either
 * flow offers a set of options to choose from -- the workflow planner returns
 * plain strings and the engine's project clarifications carry an empty
 * options array -- so offering buttons here would be inventing the choices.
 */
export function ClarificationQuestions({
  questions,
  onSubmit,
  pending = false,
  submitLabel = "Answer and continue",
}: ClarificationQuestionsProps) {
  const [answers, setAnswers] = React.useState<Record<string, string>>({})

  const missing = questions.some(
    (item) => item.required !== false && (answers[item.id] ?? "").trim().length === 0,
  )

  return (
    <form
      className="mt-2 space-y-4 rounded-lg border border-border bg-surface-raised p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (missing || pending) return
        const trimmed: Record<string, string> = {}
        for (const item of questions) {
          const answer = (answers[item.id] ?? "").trim()
          if (answer.length > 0) trimmed[item.id] = answer
        }
        onSubmit(trimmed)
      }}
    >
      {questions.map((item) => (
        <div key={item.id} className="space-y-2">
          <label className="block text-sm font-medium" htmlFor={`clarification-${item.id}`}>
            {item.question}
          </label>
          <Input
            id={`clarification-${item.id}`}
            value={answers[item.id] ?? ""}
            onChange={(event) =>
              setAnswers((previous) => ({ ...previous, [item.id]: event.target.value }))
            }
            disabled={pending}
            placeholder="Your answer"
          />
        </div>
      ))}
      <Button type="submit" size="sm" disabled={missing || pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {submitLabel}
      </Button>
    </form>
  )
}
