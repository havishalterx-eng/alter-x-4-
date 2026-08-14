import { cn } from "@/lib/utils"

interface DiffViewerProps {
  content: string
  className?: string
}

export function DiffViewer({ content, className }: DiffViewerProps) {
  const lines = content.split("\n")

  return (
    <div className={cn("font-mono text-sm bg-[#1e1e1e] text-gray-300 rounded-lg overflow-hidden border border-border", className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, i) => {
              const isAdded = line.startsWith("+")
              const isRemoved = line.startsWith("-")
              
              return (
                <tr 
                  key={i} 
                  className={cn(
                    isAdded && "bg-emerald-500/10 text-emerald-400",
                    isRemoved && "bg-destructive/10 text-destructive-foreground/80"
                  )}
                >
                  <td className="w-10 px-2 py-0.5 text-right select-none text-gray-600 bg-black/20 border-r border-white/5">
                    {i + 1}
                  </td>
                  <td className="w-6 px-2 text-center select-none opacity-50">
                    {isAdded ? "+" : isRemoved ? "-" : " "}
                  </td>
                  <td className="px-2 py-0.5 whitespace-pre">
                    {line.substring(line.startsWith("+") || line.startsWith("-") ? 1 : 0)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
