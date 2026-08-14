import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { PageHeader } from "@/components/common/page-header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CreditCard, Loader2 } from "lucide-react"

export function PaymentMethodPage() {
  const queryClient = useQueryClient()
  const { data: pm, isLoading } = useQuery({
    queryKey: queryKeys.billing.paymentMethod,
    queryFn: () => api.billing.getPaymentMethod()
  })

  const [name, setName] = useState("")
  const [last4, setLast4] = useState("")
  const [expiry, setExpiry] = useState("")

  const mutation = useMutation({
    mutationFn: () => api.billing.updatePaymentMethod({ name, last4, expiry }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.billing.paymentMethod })
      alert("Payment method updated (Mock)")
      setName("")
      setLast4("")
      setExpiry("")
    }
  })

  if (isLoading || !pm) return <div className="p-8 text-muted-foreground animate-pulse">Loading...</div>

  return (
    <div className="space-y-8">
      <PageHeader 
        title="Payment Method"
        description="Manage the credit card used for your AlterX subscription."
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Current Method</CardTitle>
            <CardDescription>This card will be charged for your next invoice.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 p-4 border rounded-md bg-surface-hover">
              <div className="h-10 w-14 bg-white rounded flex items-center justify-center shadow-sm">
                <CreditCard className="h-6 w-6 text-slate-800" />
              </div>
              <div>
                <div className="font-medium">{pm.brand} ending in {pm.last4}</div>
                <div className="text-sm text-muted-foreground">Expires {pm.expMonth}/{pm.expYear}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}>
            <CardHeader>
              <CardTitle>Update Payment Method</CardTitle>
              <CardDescription className="text-danger flex items-center gap-1 mt-1">
                Development environment. Do NOT enter real card numbers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Cardholder Name (Mock)</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Doe" required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Card Number (Mock last 4)</Label>
                  <Input value={last4} onChange={e => setLast4(e.target.value)} placeholder="1234" maxLength={4} required />
                </div>
                <div className="space-y-2">
                  <Label>Expiry (Mock)</Label>
                  <Input value={expiry} onChange={e => setExpiry(e.target.value)} placeholder="MM/YY" maxLength={5} required />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={mutation.isPending || !name || !last4 || !expiry}>
                {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Payment Method
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  )
}
