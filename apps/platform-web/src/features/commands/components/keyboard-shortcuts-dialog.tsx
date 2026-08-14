import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Command } from "lucide-react"

interface KeyboardShortcutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function KeyboardShortcutsDialog({ open, onOpenChange }: KeyboardShortcutsDialogProps) {
  const shortcuts = [
    { label: "Global Command Palette", keys: ["⌘", "K"] },
    { label: "Go to Home", keys: ["G", "H"] },
    { label: "Go to Workflows", keys: ["G", "W"] },
    { label: "Go to Projects", keys: ["G", "P"] },
    { label: "Go to Runs", keys: ["G", "R"] },
    { label: "Go to Settings", keys: ["G", "S"] },
    { label: "Toggle Theme", keys: ["T", "T"] },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Command className="h-4 w-4" />
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {shortcuts.map((shortcut, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="text-sm font-medium text-text-secondary">{shortcut.label}</span>
              <div className="flex items-center gap-1">
                {shortcut.keys.map((key, j) => (
                  <kbd key={j} className="inline-flex h-5 items-center justify-center rounded border border-border bg-surface-raised px-1.5 font-mono text-[10px] font-medium text-text-primary">
                    {key}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
