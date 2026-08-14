import * as React from "react"
import { Copy, RefreshCcw, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface TerminalViewProps {
  lines: string[]
  className?: string
}

export function TerminalView({ lines, className }: TerminalViewProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = React.useState(true)

  React.useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [lines, autoScroll])

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement
    const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 50
    setAutoScroll(isAtBottom)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(lines.join("\n"))
    toast.success("Copied to clipboard")
  }

  return (
    <div className={cn("flex flex-col bg-[#1e1e1e] rounded-xl overflow-hidden border border-border shadow-inner font-mono text-xs", className)}>
      <div className="flex items-center justify-between px-4 py-2 bg-black/40 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>
          <span className="ml-4 text-white/50 text-[11px] font-sans font-medium">Terminal</span>
        </div>
        <div className="flex items-center gap-1 text-white/50">
          <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-white/10 hover:text-white" onClick={handleCopy}>
            <Copy className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-white/10 hover:text-white" onClick={() => {
            const blob = new Blob([lines.join("\n")], { type: "text/plain" })
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = "terminal_output.log"
            a.click()
            URL.revokeObjectURL(url)
          }}>
            <Download className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 text-gray-300 space-y-1"
      >
        {lines.length === 0 ? (
          <div className="text-gray-500 italic">No output yet...</div>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={cn("whitespace-pre-wrap break-all", line.includes("failed") || line.includes("Error") ? "text-red-400" : "")}>
              {line}
            </div>
          ))
        )}
      </div>
      {!autoScroll && (
        <button 
          onClick={() => {
            setAutoScroll(true)
            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
          }}
          className="absolute bottom-6 right-6 flex items-center gap-2 bg-primary/20 text-primary px-3 py-1.5 rounded-full text-xs hover:bg-primary/30 transition-colors backdrop-blur-sm border border-primary/20 shadow-lg"
        >
          <RefreshCcw className="h-3 w-3" />
          Resume auto-scroll
        </button>
      )}
    </div>
  )
}
