import * as React from "react"
import { ChevronRight, ChevronDown, Folder, File, FileJson, FileCode, FileImage } from "lucide-react"
import { type ProjectFile } from "@/api/types"
import { cn } from "@/lib/utils"

interface FileTreeProps {
  files: ProjectFile[]
  selectedFileId?: string
  onSelect: (file: ProjectFile) => void
}

function getFileIcon(file: ProjectFile) {
  if (file.type === "directory") return <Folder className="h-4 w-4 text-primary fill-primary-soft" />
  
  if (file.name.endsWith(".json")) return <FileJson className="h-4 w-4 text-yellow-500" />
  if (file.name.match(/\.(tsx?|jsx?|css|html|md)$/)) return <FileCode className="h-4 w-4 text-emerald-500" />
  if (file.name.match(/\.(png|jpg|svg)$/)) return <FileImage className="h-4 w-4 text-primary" />
  
  return <File className="h-4 w-4 text-muted-foreground" />
}

function buildTree(files: ProjectFile[]) {
  const root: any[] = []
  const map = new Map<string, any>()
  
  // Sort files: directories first, then alphabetically
  const sorted = [...files].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  sorted.forEach(file => {
    map.set(file.path, { ...file, children: [] })
  })

  sorted.forEach(file => {
    const parts = file.path.split("/")
    if (parts.length === 1) {
      root.push(map.get(file.path))
    } else {
      parts.pop()
      const parentPath = parts.join("/")
      if (map.has(parentPath)) {
        map.get(parentPath).children.push(map.get(file.path))
      } else {
        root.push(map.get(file.path))
      }
    }
  })

  return root
}

function TreeNode({ node, depth = 0, selectedFileId, onSelect }: { node: any, depth?: number, selectedFileId?: string, onSelect: (f: ProjectFile) => void }) {
  const [expanded, setExpanded] = React.useState(true)
  
  const isSelected = selectedFileId === node.id
  
  return (
    <div>
      <div 
        className={cn(
          "flex items-center gap-1.5 py-1 px-2 hover:bg-surface-hover/50 cursor-pointer text-sm rounded-md mx-1",
          isSelected && "bg-primary/10 text-primary hover:bg-primary/20 font-medium"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => {
          if (node.type === "directory") setExpanded(!expanded)
          else onSelect(node)
        }}
      >
        <div className="w-4 h-4 flex items-center justify-center">
          {node.type === "directory" && (
            expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
          )}
        </div>
        {getFileIcon(node)}
        <span className="truncate">{node.name}</span>
        {node.status && node.status !== "unchanged" && (
          <span className={cn(
            "ml-auto text-[10px] uppercase font-bold px-1.5 rounded-sm",
            node.status === "created" ? "bg-emerald-500/20 text-emerald-500" :
            node.status === "modified" ? "bg-primary-soft text-primary" :
            "bg-destructive/20 text-destructive"
          )}>
            {node.status.charAt(0)}
          </span>
        )}
      </div>
      {node.type === "directory" && expanded && node.children?.map((child: any) => (
        <TreeNode 
          key={child.id} 
          node={child} 
          depth={depth + 1} 
          selectedFileId={selectedFileId} 
          onSelect={onSelect} 
        />
      ))}
    </div>
  )
}

export function FileTree({ files, selectedFileId, onSelect }: FileTreeProps) {
  const tree = React.useMemo(() => buildTree(files), [files])

  return (
    <div className="py-2">
      {tree.map(node => (
        <TreeNode 
          key={node.id} 
          node={node} 
          selectedFileId={selectedFileId} 
          onSelect={onSelect} 
        />
      ))}
    </div>
  )
}
