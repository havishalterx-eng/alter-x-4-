import { useQuery } from "@tanstack/react-query"
import { PhoneCall } from "lucide-react"

import { PageHeader } from "@/components/common/page-header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { formatDistanceToNow } from "date-fns"

export function VoiceChannelPage() {
  const { data: channels, isLoading } = useQuery({
    queryKey: queryKeys.channels.voice.list,
    queryFn: () => api.getVoiceChannels()
  })

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <PageHeader 
        title="Voice Integration"
        description="Connect conversational agents to voice telephony systems."
        primaryAction={
          <Button>Connect Number</Button>
        }
      />

      <div className="mt-8">
        {isLoading ? (
          <div>Loading channels...</div>
        ) : channels && channels.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {channels.map(ch => (
              <Card key={ch.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary-soft rounded-md">
                        <PhoneCall className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{ch.name}</CardTitle>
                        <CardDescription className="font-mono mt-1 text-xs">
                          {ch.phoneNumber || "No number assigned"}
                        </CardDescription>
                      </div>
                    </div>
                    <Badge variant={ch.status === 'connected' ? 'default' : 'secondary'}>
                      {ch.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-2 text-sm text-muted-foreground flex flex-col gap-2 border-t mt-4 pt-4">
                  <div className="flex justify-between">
                    <span>Provider: <span className="capitalize text-foreground font-medium">{ch.provider}</span></span>
                    <span>Voice: <span className="text-foreground font-medium">{ch.voice || 'Default'}</span> ({ch.language || 'en-US'})</span>
                  </div>
                  <div className="text-xs mt-2 text-right">
                    Created {formatDistanceToNow(new Date(ch.createdAt), { addSuffix: true })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="p-12 border border-dashed rounded-lg text-center text-muted-foreground">
            <PhoneCall className="mx-auto h-12 w-12 opacity-50 mb-4" />
            <p>No Voice channels connected.</p>
          </div>
        )}
      </div>
    </div>
  )
}
