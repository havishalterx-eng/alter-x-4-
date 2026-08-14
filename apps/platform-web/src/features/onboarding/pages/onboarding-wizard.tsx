import * as React from "react"
import { useNavigate } from "react-router-dom"
import { SquareTerminal, ArrowRight, Check, Sparkles, Building2, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useOnboarding } from "../hooks/useOnboarding"

export function OnboardingWizard() {
  const { currentStep, setCurrentStep, setCompleted, updateData, workspaceName, workspaceSlug, useCases } = useOnboarding()
  const navigate = useNavigate()

  const handleComplete = () => {
    setCompleted(true)
    navigate("/app/dashboard", { replace: true })
  }

  return (
    <div className="flex min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-xl flex-col px-4 pt-24 sm:px-6 md:pt-32">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary font-bold text-lg tracking-tight">
            <SquareTerminal className="h-6 w-6" />
            <span>AlterX</span>
          </div>
          <div className="text-sm text-text-muted">
            Step {currentStep} of 5
          </div>
        </div>

        <div className="flex-1">
          {currentStep === 1 && (
            <StepWelcome onNext={() => setCurrentStep(2)} />
          )}
          {currentStep === 2 && (
            <StepWorkspace 
              onNext={() => setCurrentStep(3)} 
              data={{ workspaceName, workspaceSlug }}
              updateData={updateData}
            />
          )}
          {currentStep === 3 && (
            <StepUseCases 
              onNext={() => setCurrentStep(4)} 
              useCases={useCases}
              updateData={updateData}
            />
          )}
          {currentStep === 4 && (
            <StepInvite onNext={() => setCurrentStep(5)} />
          )}
          {currentStep === 5 && (
            <StepReady onComplete={handleComplete} />
          )}
        </div>
      </div>
    </div>
  )
}

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
        <Sparkles className="h-6 w-6 text-primary" />
      </div>
      <h1 className="mb-4 text-3xl font-bold tracking-tight text-text-primary">
        Welcome to AlterX
      </h1>
      <p className="mb-8 text-lg text-text-secondary leading-relaxed">
        Let's set up your workspace so you can start building intelligent workflows and projects. This will only take a minute.
      </p>
      <Button size="lg" className="w-full sm:w-auto gap-2" onClick={onNext}>
        Continue <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

function StepWorkspace({ onNext, data, updateData }: any) {
  const [name, setName] = React.useState(data.workspaceName || "")
  const [slug, setSlug] = React.useState(data.workspaceSlug || "")

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setName(newName)
    if (!data.workspaceSlug || data.workspaceSlug === slug) {
      setSlug(newName.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""))
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim() && slug.trim()) {
      updateData({ workspaceName: name, workspaceSlug: slug })
      onNext()
    }
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-raised border border-border">
        <Building2 className="h-6 w-6 text-text-primary" />
      </div>
      <h1 className="mb-2 text-2xl font-bold text-text-primary">Name your workspace</h1>
      <p className="mb-8 text-text-secondary">This is where your team will collaborate on workflows.</p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium text-text-primary">Workspace name</label>
          <Input 
            autoFocus
            placeholder="Acme AI" 
            value={name} 
            onChange={handleNameChange}
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-text-primary">Workspace URL</label>
          <div className="flex">
            <span className="inline-flex items-center rounded-l-md border border-r-0 border-border bg-surface-hover px-3 text-sm text-text-muted">
              alterx.ai/
            </span>
            <Input 
              className="rounded-l-none"
              placeholder="acme-ai" 
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
            />
          </div>
        </div>
        <Button size="lg" className="w-full gap-2" type="submit">
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </form>
    </div>
  )
}

function StepUseCases({ onNext, useCases, updateData }: any) {
  const options = [
    "Business automation",
    "AI agents",
    "Customer support",
    "Sales operations",
    "Research",
    "Software development",
    "Data processing",
    "Other",
  ]

  const toggleOption = (opt: string) => {
    const newSelection = useCases.includes(opt)
      ? useCases.filter((o: string) => o !== opt)
      : [...useCases, opt]
    updateData({ useCases: newSelection })
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h1 className="mb-2 text-2xl font-bold text-text-primary">What will you use AlterX for?</h1>
      <p className="mb-8 text-text-secondary">Select all that apply to help us tailor your experience.</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 mb-8">
        {options.map((opt) => {
          const selected = useCases.includes(opt)
          return (
            <button
              key={opt}
              onClick={() => toggleOption(opt)}
              className={`flex items-center justify-between rounded-lg border p-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background ${
                selected 
                  ? "border-primary bg-primary/5 text-primary" 
                  : "border-border bg-surface hover:border-border-strong hover:bg-surface-hover text-text-secondary"
              }`}
            >
              <span className="font-medium text-sm">{opt}</span>
              {selected && <Check className="h-4 w-4" />}
            </button>
          )
        })}
      </div>
      <Button size="lg" className="w-full gap-2" onClick={onNext} disabled={useCases.length === 0}>
        Continue <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

function StepInvite({ onNext }: { onNext: () => void }) {
  const [emails, setEmails] = React.useState([""])

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-raised border border-border">
        <Users className="h-6 w-6 text-text-primary" />
      </div>
      <h1 className="mb-2 text-2xl font-bold text-text-primary">Invite your team</h1>
      <p className="mb-8 text-text-secondary">Collaboration is better together. Add teammates to your workspace.</p>

      <div className="space-y-4 mb-8">
        {emails.map((email, i) => (
          <Input 
            key={i}
            placeholder="teammate@company.com"
            value={email}
            onChange={(e) => {
              const newEmails = [...emails]
              newEmails[i] = e.target.value
              setEmails(newEmails)
            }}
          />
        ))}
        <Button variant="ghost" size="sm" onClick={() => setEmails([...emails, ""])}>
          + Add another
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Button size="lg" className="flex-1 gap-2" onClick={onNext}>
          Send invitations <ArrowRight className="h-4 w-4" />
        </Button>
        <Button size="lg" variant="ghost" onClick={onNext}>
          Skip for now
        </Button>
      </div>
    </div>
  )
}

function StepReady({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 text-center flex flex-col items-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-success/15 border border-success/20">
        <Check className="h-8 w-8 text-success" />
      </div>
      <h1 className="mb-4 text-3xl font-bold tracking-tight text-text-primary">
        Your workspace is ready.
      </h1>
      <p className="mb-8 text-lg text-text-secondary leading-relaxed max-w-sm">
        Everything is set up. You can now start building intelligent workflows and managing agents.
      </p>
      <Button size="lg" className="w-full sm:w-auto" onClick={onComplete}>
        Start using AlterX
      </Button>
    </div>
  )
}
