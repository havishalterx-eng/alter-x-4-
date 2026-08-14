import type { Permission } from "@/api/types"
import { create } from "zustand"

export type CommandType = "navigation" | "create" | "action" | "search_result" | "setting"

export interface CommandItem {
  id: string
  label: string
  description?: string
  type: CommandType
  keywords?: string[]
  shortcut?: string[]
  icon?: React.ElementType
  permission?: Permission
  execute: () => void
}

interface CommandState {
  contextCommands: CommandItem[]
  setContextCommands: (commands: CommandItem[]) => void
}

export const useCommandStore = create<CommandState>((set) => ({
  contextCommands: [],
  setContextCommands: (commands) => set({ contextCommands: commands })
}))

export const defaultCommands: CommandItem[] = [
  {
    id: "nav_home",
    label: "Go to Home",
    type: "navigation",
    execute: () => { window.location.href = "/app/home" }
  },
  {
    id: "nav_workflows",
    label: "Go to Workflows",
    type: "navigation",
    execute: () => { window.location.href = "/app/workflows" }
  },
  {
    id: "nav_projects",
    label: "Go to Projects",
    type: "navigation",
    execute: () => { window.location.href = "/app/projects" }
  },
  {
    id: "nav_runs",
    label: "Go to Runs",
    type: "navigation",
    execute: () => { window.location.href = "/app/runs" }
  },
  {
    id: "nav_human_actions",
    label: "View Human Actions",
    type: "navigation",
    execute: () => { window.location.href = "/app/human-actions" }
  },
  {
    id: "nav_notifications",
    label: "View Notifications",
    type: "navigation",
    execute: () => { window.location.href = "/app/notifications" }
  },
  {
    id: "nav_usage",
    label: "Open Usage",
    type: "navigation",
    execute: () => { window.location.href = "/app/usage" }
  },
  {
    id: "nav_settings",
    label: "Open Settings",
    type: "navigation",
    execute: () => { window.location.href = "/app/settings/profile" }
  },
  {
    id: "action_new_workflow",
    label: "New workflow",
    type: "create",
    permission: "workflow.create",
    execute: () => { window.location.href = "/app/workflows/new" }
  },
  {
    id: "action_new_project",
    label: "New project",
    type: "create",
    permission: "project.create",
    execute: () => { window.location.href = "/app/projects/new" }
  },
  {
    id: "action_start_conv",
    label: "Start conversation",
    type: "action",
    execute: () => { window.location.href = "/app/home" }
  },
  {
    id: "theme_light",
    label: "Theme: Light",
    type: "setting",
    execute: () => { document.documentElement.classList.remove("dark") }
  },
  {
    id: "theme_dark",
    label: "Theme: Dark",
    type: "setting",
    execute: () => { document.documentElement.classList.add("dark") }
  }
]

const MAX_RECENT = 5

export const commandRegistry = {
  getRecentCommandIds: (): string[] => {
    try {
      const data = localStorage.getItem("alterx_recent_commands")
      return data ? JSON.parse(data) : []
    } catch {
      return []
    }
  },
  
  addRecentCommandId: (id: string) => {
    try {
      const recent = commandRegistry.getRecentCommandIds()
      const newRecent = [id, ...recent.filter(x => x !== id)].slice(0, MAX_RECENT)
      localStorage.setItem("alterx_recent_commands", JSON.stringify(newRecent))
    } catch (e) {
      console.error("Failed to save recent command", e)
    }
  }
}
