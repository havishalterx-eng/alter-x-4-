import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Sparkles, Loader2, Network } from "lucide-react"
import { Composer } from "@/components/conversation/Composer"
import { MessageList } from "@/components/conversation/MessageList"
import { ClarificationCard } from "@/components/conversation/ClarificationCard"
import { SuggestionCard } from "@/components/conversation/SuggestionCard"
import { StructuredArtifactMessage } from "@/components/conversation/StructuredArtifactMessage"
import { useMutation } from "@tanstack/react-query"
import { api } from "@/api/client"
import { type ChatMessage } from "@/api/types"

export function WorkflowCreate() {
  const navigate = useNavigate()
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  
  const compileMutation = useMutation({
    mutationFn: api.compileWorkflow,
    onSuccess: (data) => {
      setMessages(prev => [
        ...prev,
        {
          id: `msg_${Date.now()}`,
          role: "assistant",
          type: "workflow_draft",
          content: data.explanation,
          data: data.workflow,
          createdAt: new Date().toISOString()
        }
      ])
    }
  })

  const suggestions = [
    "Route urgent support emails to Slack",
    "Research new leads and score them automatically",
    "Review invoices and request approval above $5,000",
    "Monitor failed deployments and create incident reports"
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

    // Mock Clarification logic
    if (messages.length === 0 && text.toLowerCase().includes("support")) {
      setTimeout(() => {
        setMessages(prev => [
          ...prev,
          {
            id: `msg_a_${Date.now()}`,
            role: "assistant",
            type: "clarification",
            content: "Before I create this workflow, I need one detail.",
            data: {
              question: "Where should urgent issues be sent?",
              options: ["Slack", "Microsoft Teams", "Email"]
            },
            createdAt: new Date().toISOString()
          }
        ])
      }, 800)
    } else {
      compileMutation.mutate({ goal: text, answers: {} })
    }
  }

  const handleClarification = (option: string) => {
    handleSend(option)
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-surface">
      <div className="border-b border-border bg-surface px-6 py-4">
        <h1 className="text-xl font-semibold">Create Workflow</h1>
        <p className="text-sm text-muted-foreground">Describe what you want to automate</p>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center pt-20">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="h-8 w-8" />
              </div>
              <h2 className="mb-8 text-2xl font-semibold">What do you want to automate?</h2>
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
                  return (
                    <div className="space-y-2">
                      <p>{msg.content}</p>
                      <ClarificationCard 
                        question={msg.data.question} 
                        options={msg.data.options} 
                        onSelect={handleClarification} 
                      />
                    </div>
                  )
                }
                if (msg.type === "workflow_draft") {
                  return (
                    <div className="space-y-2">
                      <p>{msg.content}</p>
                      <StructuredArtifactMessage
                        title="Workflow ready for review"
                        subtitle={msg.data.name}
                        content={
                          <div className="flex items-center gap-4 py-2">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                              <Network className="h-5 w-5" />
                            </div>
                            <div>
                              <p className="font-medium text-foreground">Draft Generated</p>
                              <p className="text-muted-foreground">Click below to open the builder.</p>
                            </div>
                          </div>
                        }
                        primaryActionLabel="Open builder"
                        onPrimaryAction={() => navigate(`/app/workflows/${msg.data.id}/build`)}
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
              Generating workflow...
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-surface p-4">
        <div className="mx-auto max-w-3xl">
          <Composer 
            onSend={handleSend} 
            loading={compileMutation.isPending} 
            disabled={messages[messages.length - 1]?.type === "clarification" || messages[messages.length - 1]?.type === "workflow_draft"}
          />
        </div>
      </div>
    </div>
  )
}
