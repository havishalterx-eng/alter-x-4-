import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Search, Loader2, Play, GitFork, MessageSquare, Database, Store, Cable, Compass, Zap, Plus, Settings } from "lucide-react"
import { useCommandStore, defaultCommands, commandRegistry } from "../../commands/command-registry"

interface GlobalSearchModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function GlobalSearchModal({ open, onOpenChange }: GlobalSearchModalProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState("")

  // Use debounced query for api call
  const [debouncedQuery, setDebouncedQuery] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(timer)
  }, [query])

  const { data: results, isLoading } = useQuery({
    queryKey: queryKeys.globalSearch(debouncedQuery),
    queryFn: () => (api as any).globalSearch(debouncedQuery),
    enabled: debouncedQuery.length > 0,
  })

  const { contextCommands } = useCommandStore()

  // Build the list of commands
  const allCommands = [...contextCommands, ...defaultCommands]
  const recentCommandIds = commandRegistry.getRecentCommandIds()
  
  const filteredCommands = query
    ? allCommands.filter(c => c.label.toLowerCase().includes(query.toLowerCase()) || c.keywords?.some(k => k.toLowerCase().includes(query.toLowerCase())))
    : allCommands.filter(c => recentCommandIds.includes(c.id)).sort((a, b) => recentCommandIds.indexOf(a.id) - recentCommandIds.indexOf(b.id))


  // Group results by type
  const groups = results?.reduce((acc: Record<string, any[]>, item: any) => {
    const group = item.type
    if (!acc[group]) acc[group] = []
    acc[group].push(item)
    return acc
  }, {})

  const getIcon = (type: string) => {
    switch (type) {
      case "workflow": return <GitFork className="h-4 w-4" />
      case "project": return <Play className="h-4 w-4" />
      case "run": return <Play className="h-4 w-4" />
      case "conversation": return <MessageSquare className="h-4 w-4" />
      case "knowledge_source": return <Database className="h-4 w-4" />
      case "connection": return <Cable className="h-4 w-4" />
      case "marketplace_listing": return <Store className="h-4 w-4" />
      case "navigation": return <Compass className="h-4 w-4" />
      case "action": return <Zap className="h-4 w-4" />
      case "create": return <Plus className="h-4 w-4" />
      case "setting": return <Settings className="h-4 w-4" />
      default: return <Search className="h-4 w-4" />
    }
  }

  const handleSelect = (url: string) => {
    onOpenChange(false)
    navigate(url)
  }

  const handleCommand = (command: any) => {
    onOpenChange(false)
    commandRegistry.addRecentCommandId(command.id)
    command.execute()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] p-0 overflow-hidden shadow-2xl">
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search AlterX..."
            className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none border-0 focus-visible:ring-0 placeholder:text-muted-foreground"
          />
          {isLoading && <Loader2 className="h-4 w-4 animate-spin opacity-50" />}
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {!query && (
            <div className="mb-4">
              <h3 className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                {filteredCommands.length > 0 ? "Recent Commands" : "Suggested"}
              </h3>
              <div className="space-y-1">
                {(filteredCommands.length > 0 ? filteredCommands : allCommands.slice(0, 5)).map((cmd) => (
                  <button
                    key={cmd.id}
                    onClick={() => handleCommand(cmd)}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-surface-hover hover:text-primary transition-colors focus:bg-surface-hover focus:outline-none"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded bg-surface border shrink-0 text-muted-foreground">
                        {getIcon(cmd.type)}
                      </div>
                      <div className="font-medium">{cmd.label}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {query && filteredCommands.length > 0 && (
            <div className="mb-4">
              <h3 className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Commands
              </h3>
              <div className="space-y-1">
                {filteredCommands.slice(0, 5).map((cmd) => (
                  <button
                    key={cmd.id}
                    onClick={() => handleCommand(cmd)}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-surface-hover hover:text-primary transition-colors focus:bg-surface-hover focus:outline-none"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded bg-surface border shrink-0 text-muted-foreground">
                        {getIcon(cmd.type)}
                      </div>
                      <div className="font-medium">{cmd.label}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {query && !isLoading && results?.length === 0 && filteredCommands.length === 0 && (
            <div className="py-14 text-center text-sm text-muted-foreground">
              No results found for "{query}".
            </div>
          )}
          {groups && Object.entries(groups as Record<string, any[]>).map(([type, items]) => (
            <div key={type} className="mb-4">
              <h3 className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                {type.replace("_", " ")}
              </h3>
              <div className="space-y-1">
                {items.map((item: any) => (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item.url)}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-surface-hover hover:text-primary transition-colors focus:bg-surface-hover focus:outline-none"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-surface border shrink-0 text-muted-foreground">
                      {getIcon(item.type)}
                    </div>
                    <div>
                      <div className="font-medium">{item.title}</div>
                      {item.description && <div className="text-xs text-muted-foreground">{item.description}</div>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
