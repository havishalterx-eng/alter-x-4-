import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/api/client"
import { isLiveApi } from "@/api/http"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react"

export function KycPage() {
  const queryClient = useQueryClient()
  
  const { data: profile, isLoading, error } = useQuery({
    queryKey: queryKeys.seller.profile, 
    queryFn: () => api.seller.getProfile() 
  })

  const [name, setName] = useState("")
  const [address, setAddress] = useState("")

  const mutation = useMutation({
    mutationFn: () => api.seller.updateProfile({ status: "pending" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.seller.profile })
      alert("Submitted for review (Mock)")
    }
  })

  if (isLoading) return <div className="p-8 text-muted-foreground animate-pulse">Loading...</div>
  if (error) return <div role="alert" className="p-8 text-destructive">Could not load verification status: {error.message}</div>

  const status = profile?.status || "not_started"

  if (isLiveApi) return (
    <div className="space-y-8 max-w-2xl">
      <PageHeader title="Seller Verification" description="Review your publisher verification status." />
      <Card>
        <CardHeader><CardTitle>Verification Status</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {status === "verified" && <Badge variant="success">Verified</Badge>}
          {status === "pending" && <Badge variant="warning">Under review</Badge>}
          {status === "restricted" && <Badge variant="danger">Rejected</Badge>}
          {status === "not_started" && <Badge variant="secondary">Not started</Badge>}
          {status === "not_started" && <p className="text-sm text-muted-foreground">Secure document submission is being set up. You can create draft listings now; review submission will become available after verification is ready.</p>}
          {status === "pending" && <p className="text-sm text-muted-foreground">Your documents are awaiting manual review.</p>}
          {status === "restricted" && <p className="text-sm text-muted-foreground">Contact support to review your verification outcome.</p>}
        </CardContent>
      </Card>
    </div>
  )

  return (
    <div className="space-y-8 max-w-2xl">
      <PageHeader 
        title="Seller Verification"
        description="Verify your identity to receive payouts and publish assets."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Verification Status
            {status === "verified" && <Badge variant="success" className="flex gap-1"><CheckCircle2 className="h-3 w-3" /> Verified</Badge>}
            {status === "pending" && <Badge variant="warning" className="flex gap-1"><Loader2 className="h-3 w-3 animate-spin" /> In Review</Badge>}
            {status === "not_started" && <Badge variant="secondary">Not Started</Badge>}
          </CardTitle>
        </CardHeader>
        {status === "not_started" && (
          <form onSubmit={e => { e.preventDefault(); mutation.mutate(); }}>
            <CardContent className="space-y-4">
              <div className="bg-primary/10 text-primary p-3 rounded-md text-sm mb-4 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                This is a mock seller verification experience. Do NOT enter real government IDs or PII.
              </div>
              <div className="space-y-2">
                <Label>Legal Business Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Acme Corp" required />
              </div>
              <div className="space-y-2">
                <Label>Business Address</Label>
                <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="123 Automation St" required />
              </div>
              <div className="space-y-2">
                <Label>Simulated Identity Document</Label>
                <Input type="file" className="cursor-not-allowed text-muted-foreground" disabled />
                <p className="text-xs text-muted-foreground">File upload disabled for mock environment.</p>
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={mutation.isPending || !name || !address}>
                {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit Verification
              </Button>
            </CardFooter>
          </form>
        )}
        
        {status === "pending" && (
          <CardContent className="py-8 text-center text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p>Your verification is currently under review.</p>
            <p className="text-sm mt-2">This usually takes 1-2 business days.</p>
          </CardContent>
        )}

        {status === "verified" && (
          <CardContent className="py-8 text-center text-success">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-4" />
            <p className="font-medium text-text-primary">You are fully verified!</p>
            <p className="text-sm text-muted-foreground mt-2">You can publish assets and receive payouts without restrictions.</p>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
