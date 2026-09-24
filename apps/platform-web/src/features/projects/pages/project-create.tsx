import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Sparkles, Loader2, Briefcase } from "lucide-react"
import { Composer } from "@/components/conversation/Composer"
import { MessageList } from "@/components/conversation/MessageList"
import { SuggestionCard } from "@/components/conversation/SuggestionCard"
import { ClarificationQuestions } from "@/components/conversation/clarification-questions"
import { StructuredArtifactMessage } from "@/components/conversation/StructuredArtifactMessage"
import { useMutation } from "@tanstack/react-query"
import { api } from "@/api/client"
import { type ChatMessage, type ProjectClarification } from "@/api/types"

export function ProjectCreate() {
  const navigate = useNavigate()
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  
  const [projectId, setProjectId] = React.useState<string | undefined>(undefined)

  const clarificationMessage = (clarifications: ProjectClarification[]): ChatMessage => ({
    id: `msg_c_${Date.now()}`,
    role: "assistant",
    type: "clarification",
    content:
      clarifications.length === 1
        ? "One thing before the plan is written."
        : "A few things before the plan is written.",
    data: { clarifications },
    createdAt: new Date().toISOString()
  })

  const compileMutation = useMutation({
    mutationFn: api.compileProjectBrief,
    onSuccess: (data) => {
      setProjectId(data.projectId)
      setMessages(prev => [
        ...prev,
        {
          id: `msg_${Date.now()}`,
          role: "assistant",
          type: "project_brief",
          content: "I've reviewed your request and prepared a Project Brief.",
          data: {
            // The project the engine really created, so opening it goes
            // somewhere. This used to be a timestamp, which resolved to
            // nothing.
            id: data.projectId,
            name: data.brief.goal,
            brief: data.brief
          },
          createdAt: new Date().toISOString()
        },
        ...(data.clarifications.length > 0 ? [clarificationMessage(data.clarifications)] : [])
      ])
    }
  })

  const answerMutation = useMutation({
    mutationFn: (variables: { id: string; answers: Record<string, string> }) =>
      api.answerProjectClarifications(variables.id, variables.answers),
    onSuccess: (remaining) => {
      // The planner writes the next part of the plan from the answers, and
      // may have more to ask.
      if (remaining.length > 0) setMessages(prev => [...prev, clarificationMessage(remaining)])
    }
  })

  const suggestions = [
    "Build a customer portal for my SaaS",
    "Create an internal analytics dashboard",
    "Research competitors and prepare a market report",
    "Build a support automation system"
  ]

  const handleSend = (text: string) => {
    setMessages(prev => [
      ...prev,
      {
        id: `msg_u_${Date.now()}`,
        role: "user",
        type: "text",
        content: text,
        createdAt: new Date().toISOString()
      }
    ])

    compileMutation.mutate({ goal: text })
  }

  const handleAnswers = (clarifications: ProjectClarification[], answers: Record<string, string>) => {
    if (!projectId) return
    const asked = new Map(clarifications.map((item) => [item.id, item.question]))
    setMessages(prev => [
      ...prev,
      {
        id: `msg_u_${Date.now()}`,
        role: "user",
        type: "text",
        content: Object.entries(answers)
          .map(([id, answer]) => `${asked.get(id) ?? ""} ${answer}`.trim())
          .join("\n"),
        createdAt: new Date().toISOString()
      }
    ])
    answerMutation.mutate({ id: projectId, answers })
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-surface">
      <div className="border-b border-border bg-surface px-6 py-4">
        <h1 className="text-xl font-semibold">Create Project</h1>
        <p className="text-sm text-muted-foreground">What do you want AlterX to build or accomplish?</p>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center pt-20">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="h-8 w-8" />
              </div>
              <h2 className="mb-8 text-2xl font-semibold">What do you want to build?</h2>
              <div className="grid w-full grid-cols-2 gap-4">
                {suggestions.map((s, i) => (
                  <SuggestionCard key={i} title={s} onClick={() => handleSend(s)} />
                ))}
              </div>
            </div>
          ) : (
            <MessageList
              messages={messages}
              renderCustomMessage={(msg) => {
                if (msg.type === "clarification") {
                  const clarifications = msg.data.clarifications as ProjectClarification[]
                  const answered = messages.indexOf(msg) < messages.length - 1
                  return (
                    <div className="space-y-2">
                      <p>{msg.content}</p>
                      {answered ? (
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                          {clarifications.map((item) => (
                            <li key={item.id}>{item.question}</li>
                          ))}
                        </ul>
                      ) : (
                        <ClarificationQuestions
                          questions={clarifications}
                          onSubmit={(answers) => handleAnswers(clarifications, answers)}
                          pending={answerMutation.isPending}
                        />
                      )}
                    </div>
                  )
                }
                if (msg.type === "project_brief") {
                  return (
                    <div className="space-y-2">
                      <p>{msg.content}</p>
                      <StructuredArtifactMessage
                        title="Project Brief Ready"
                        subtitle={msg.data.name}
                        content={
                          <div className="flex items-center gap-4 py-2">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                              <Briefcase className="h-5 w-5" />
                            </div>
                            <div>
                              <p className="font-medium text-foreground">View and review plan</p>
                              <p className="text-muted-foreground">Click to view details and approve.</p>
                            </div>
                          </div>
                        }
                        primaryActionLabel="View Project"
                        onPrimaryAction={() => navigate(`/app/projects/${msg.data.id}`)}
                      />
                    </div>
                  )
                }
                return null
              }}
            />
          )}

          {compileMutation.isPending && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Analyzing request...
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-surface p-4">
        <div className="mx-auto max-w-3xl">
          <Composer 
            onSend={handleSend} 
            loading={compileMutation.isPending} 
            disabled={messages[messages.length - 1]?.type === "clarification" || messages[messages.length - 1]?.type === "project_brief"}
          />
        </div>
      </div>
    </div>
  )
}
