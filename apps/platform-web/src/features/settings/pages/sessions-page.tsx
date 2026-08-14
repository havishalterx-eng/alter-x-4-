
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Monitor, Smartphone, Globe } from "lucide-react"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { formatDistanceToNow } from "date-fns"

export function SessionsPage() {
  const queryClient = useQueryClient()

  const { data: sessions, isLoading } = useQuery({
    queryKey: queryKeys.settings.sessions,
    queryFn: () => api.getSessions(),
  })

  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) => api.revokeSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.sessions })
      toast.success("Session revoked")
    }
  })

  const revokeOthersMutation = useMutation({
    mutationFn: () => api.revokeOtherSessions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.sessions })
      toast.success("All other sessions revoked")
    }
  })

  const handleRevoke = (sessionId: string) => {
    if (confirm("Are you sure you want to revoke this session? You will be logged out on that device.")) {
      revokeMutation.mutate(sessionId)
    }
  }

  const handleRevokeOthers = () => {
    if (confirm("Are you sure you want to revoke all other sessions?")) {
      revokeOthersMutation.mutate()
    }
  }

  return (
    <div className="space-y-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Active Sessions</h1>
          <p className="text-text-secondary mt-2">Manage the devices and browsers where you're currently signed in.</p>
        </div>
        <Button 
          variant="outline" 
          className="text-danger hover:text-danger hover:bg-danger/10"
          onClick={handleRevokeOthers}
          disabled={revokeOthersMutation.isPending || !sessions || sessions.length <= 1}
        >
          Revoke all other sessions
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-12 border rounded-xl border-border bg-surface">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface overflow-hidden divide-y divide-border">
          {sessions?.map((session) => (
            <div key={session.id} className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-raised border border-border">
                  {session.device.toLowerCase().includes("phone") ? (
                    <Smartphone className="h-5 w-5 text-text-secondary" />
                  ) : session.device.toLowerCase().includes("mac") || session.device.toLowerCase().includes("pc") ? (
                    <Monitor className="h-5 w-5 text-text-secondary" />
                  ) : (
                    <Globe className="h-5 w-5 text-text-secondary" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-text-primary">{session.device}</h4>
                    {session.isCurrent && <Badge variant="success" className="h-5 px-1.5 text-[10px]">Current</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-secondary">
                    <span>{session.browser}</span>
                    <span className="hidden sm:inline-block w-1 h-1 rounded-full bg-border-strong"></span>
                    <span>{session.location}</span>
                    <span className="hidden sm:inline-block w-1 h-1 rounded-full bg-border-strong"></span>
                    <span>{session.ip}</span>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    {session.isCurrent 
                      ? "Active now" 
                      : `Last active ${formatDistanceToNow(new Date(session.lastActive), { addSuffix: true })}`}
                  </p>
                </div>
              </div>
              {!session.isCurrent && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => handleRevoke(session.id)}
                  disabled={revokeMutation.isPending}
                >
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
