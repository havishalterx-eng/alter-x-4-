import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Bell, Check, ExternalLink } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatDistanceToNow } from "date-fns"
import { cn } from "@/lib/utils"

export function NotificationPopover() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: notifications = [] } = useQuery({
    queryKey: queryKeys.notifications.list,
    queryFn: () => api.notifications.list(),
    refetchInterval: 60000,
  })

  const { data: unreadCount = 0 } = useQuery({
    queryKey: queryKeys.notifications.unreadCount,
    queryFn: () => api.notifications.getUnreadCount(),
    refetchInterval: 60000,
  })

  const markRead = useMutation({
    mutationFn: (id: string) => api.notifications.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list })
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount })
    }
  })

  const markAllRead = useMutation({
    mutationFn: () => api.notifications.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list })
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount })
    }
  })

  const unreadNotifications = notifications.filter(n => n.status === "unread").slice(0, 5)

  const handleNotificationClick = (id: string, url?: string) => {
    markRead.mutate(id)
    setOpen(false)
    if (url) {
      navigate(url)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative rounded-full p-2 text-text-muted hover:text-text-primary hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 h-4 w-4 rounded-full bg-primary text-[9px] font-bold text-background flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0" sideOffset={8}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h4 className="text-sm font-semibold">Notifications</h4>
          {unreadCount > 0 && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-auto px-2 py-1 text-xs text-primary"
              onClick={() => markAllRead.mutate()}
            >
              <Check className="mr-1.5 h-3 w-3" />
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-[300px]">
          {unreadNotifications.length === 0 ? (
            <div className="p-8 text-center text-sm text-text-muted">
              No new notifications
            </div>
          ) : (
            <div className="flex flex-col">
              {unreadNotifications.map(notification => (
                <button
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification.id, notification.url)}
                  className="flex items-start gap-3 p-4 text-left hover:bg-surface-hover transition-colors border-b border-border/50 last:border-0"
                >
                  <div className="flex-1 space-y-1">
                    <p className={cn(
                      "text-sm font-medium leading-tight",
                      notification.priority === "high" ? "text-primary" : "text-text-primary"
                    )}>
                      {notification.title}
                    </p>
                    {notification.message && (
                      <p className="text-xs text-text-secondary line-clamp-2">
                        {notification.message}
                      </p>
                    )}
                    <p className="text-[10px] text-text-muted pt-1">
                      {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  {notification.url && (
                    <div className="shrink-0 pt-0.5">
                      <ExternalLink className="h-3.5 w-3.5 text-text-muted group-hover:text-primary transition-colors" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
        <div className="p-2 border-t border-border">
          <Button variant="ghost" size="sm" className="w-full text-xs" asChild onClick={() => setOpen(false)}>
            <Link to="/app/notifications">View all notifications</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
