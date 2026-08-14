import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Shield, Mail, UserPlus, Loader2 } from "lucide-react"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { type Member } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { RequirePermission } from "@/features/permissions/components/require-permission"
import { PermissionGate } from "@/features/permissions/components/permission-gate"
import { MemberActionMenu } from "../components/member-action-menu"
import { InviteMemberDialog } from "../components/invite-member-dialog"

export function MembersPage() {
  const [inviteOpen, setInviteOpen] = React.useState(false)

  // Using mock workspace ID
  const workspaceId = "ws_1"
  
  const { data: members, isLoading } = useQuery({
    queryKey: queryKeys.members.all(workspaceId),
    queryFn: () => api.getMembers(workspaceId),
  })

  return (
    <RequirePermission permission="member.read">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-text-primary">Members</h1>
            <p className="text-text-secondary mt-1">Manage who can access this workspace and what they can do.</p>
          </div>
          <PermissionGate permission="member.invite">
            <Button onClick={() => setInviteOpen(true)} className="gap-2">
              <UserPlus className="h-4 w-4" />
              Invite member
            </Button>
          </PermissionGate>
        </div>

        {isLoading ? (
          <div className="flex justify-center p-12 border rounded-xl border-border bg-surface">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-surface-hover border-b border-border text-text-secondary">
                  <tr>
                    <th className="px-6 py-3 font-medium">Member</th>
                    <th className="px-6 py-3 font-medium">Role</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                    <th className="px-6 py-3 font-medium">Joined</th>
                    <th className="px-6 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {members?.map((member) => (
                    <MemberRow key={member.id} member={member} workspaceId={workspaceId} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} workspaceId={workspaceId} />
      </div>
    </RequirePermission>
  )
}

function MemberRow({ member, workspaceId }: { member: Member; workspaceId: string }) {
  
  return (
    <tr className="hover:bg-surface-hover/50 transition-colors">
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            {member.avatarUrl && <AvatarImage src={member.avatarUrl} />}
            <AvatarFallback className="bg-primary/10 text-primary text-xs">
              {member.name.substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium text-text-primary">{member.name}</div>
            <div className="text-xs text-text-secondary">{member.email}</div>
          </div>
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-1.5 text-text-secondary capitalize">
          {member.role === "owner" && <Shield className="h-3.5 w-3.5 text-primary" />}
          {member.role}
        </div>
      </td>
      <td className="px-6 py-4">
        {member.status === "active" && <Badge variant="success">Active</Badge>}
        {member.status === "invited" && <Badge variant="neutral" className="gap-1"><Mail className="h-3 w-3" /> Invited</Badge>}
        {member.status === "suspended" && <Badge variant="danger">Suspended</Badge>}
      </td>
      <td className="px-6 py-4 text-text-secondary">
        {new Date(member.joinedAt).toLocaleDateString()}
      </td>
      <td className="px-6 py-4 text-right">
        <MemberActionMenu member={member} workspaceId={workspaceId} />
      </td>
    </tr>
  )
}
