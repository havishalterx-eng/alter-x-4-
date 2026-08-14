
import { Construction } from "lucide-react"
import { PageHeader } from "@/components/common/page-header"

interface PlaceholderPageProps {
  title: string
  description?: string
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="space-y-6 h-full flex flex-col">
      <PageHeader title={title} description={description} />
      
      <div className="flex-1 flex flex-col items-center justify-center rounded-xl border border-dashed border-ax-border bg-ax-surface-1/50 p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-6">
          <Construction className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-2xl font-semibold text-ax-text">Coming Soon</h2>
        <p className="mt-2 max-w-md text-ax-text-muted">
          This area is part of a later AlterX phase and is not yet implemented.
        </p>
      </div>
    </div>
  )
}
