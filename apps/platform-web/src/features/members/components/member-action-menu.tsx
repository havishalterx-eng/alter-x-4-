import { useMutation, useQueryClient } from "@tanstack/react-query"
import { MoreHorizontal } from "lucide-react"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { type Member, type WorkspaceRole } from "@/api/types"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { usePermissions } from "@/features/permissions/hooks/usePermissions"

export function MemberActionMenu({ member, workspaceId }: { member: Member; workspaceId: string }) {
  const { can } = usePermissions()
  const queryClient = useQueryClient()

  const removeMutation = useMutation({
    mutationFn: () => api.removeMember(workspaceId, member.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members.all(workspaceId) })
      toast.success("Member removed")
    }
  })

  const roleMutation = useMutation({
    mutationFn: (role: WorkspaceRole) => api.updateMemberRole(workspaceId, member.id, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members.all(workspaceId) })
      toast.success("Role updated")
    }
  })

  const resendMutation = useMutation({
    mutationFn: () => api.resendInvite(workspaceId, member.id),
    onSuccess: () => {
      toast.success("Invitation resent")
    }
  })

  const handleRemove = () => {
    if (confirm(`Remove ${member.name}? They will immediately lose access to this workspace.`)) {
      removeMutation.mutate()
    }
  }

  // Hide the menu entirely if there are no possible actions
  const canRemove = can("member.remove") && member.role !== "owner"
  const canUpdateRole = can("member.update") && member.role !== "owner"
  
  if (!canRemove && !canUpdateRole && member.status !== "invited") {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {member.status === "invited" && (
          <>
            <DropdownMenuItem onClick={() => resendMutation.mutate()}>
              Resend invitation
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        
        {canUpdateRole && (
          <>
            <DropdownMenuItem onClick={() => roleMutation.mutate("admin")}>
              Make Admin
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => roleMutation.mutate("member")}>
              Make Member
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => roleMutation.mutate("viewer")}>
              Make Viewer
            </DropdownMenuItem>
          </>
        )}
        
        {canRemove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleRemove} className="text-danger">
              Remove member
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
