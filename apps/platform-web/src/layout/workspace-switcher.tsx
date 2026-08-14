import * as React from "react"
import { Check, ChevronsUpDown, Building2 } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { type Workspace } from "@/api/types"
import { mockWorkspaces } from "@/api/mock/data"
import { CreateWorkspaceDialog } from "@/features/workspace/components/create-workspace-dialog"

export function WorkspaceSwitcher() {
  const [activeWorkspace, setActiveWorkspace] = React.useState<Workspace>(mockWorkspaces[0])
  const [createModalOpen, setCreateModalOpen] = React.useState(false)
  const navigate = useNavigate()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-3 w-full rounded-md p-2 hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          )}
        >
          <Avatar className="h-8 w-8 rounded-md border-border-strong">
            <AvatarFallback className="rounded-md bg-primary/10 text-primary">
              <Building2 className="h-4 w-4" />
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col flex-1 text-left line-clamp-1">
            <span className="text-sm font-semibold text-text-primary leading-tight truncate">
              {activeWorkspace.name}
            </span>
            <span className="text-xs text-text-muted capitalize">{activeWorkspace.role}</span>
          </div>
          <ChevronsUpDown className="h-4 w-4 text-text-muted shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[240px]" align="start" sideOffset={8}>
        {mockWorkspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.id}
            onClick={() => setActiveWorkspace(workspace)}
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-2 truncate">
              <Avatar className="h-6 w-6 rounded-md border-border-strong">
                <AvatarFallback className="rounded-md bg-surface-raised text-text-muted text-[10px]">
                  {workspace.name.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">{workspace.name}</span>
            </div>
            {activeWorkspace.id === workspace.id && (
              <Check className="h-4 w-4 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/app/settings/workspace")}>
          <span className="text-text-primary">Workspace settings</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setCreateModalOpen(true)}>
          <span className="text-text-muted">Create workspace...</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
      <CreateWorkspaceDialog open={createModalOpen} onOpenChange={setCreateModalOpen} />
    </DropdownMenu>
  )
}
