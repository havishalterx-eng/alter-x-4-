import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { api } from "@/api/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"

export function SecuritySettings() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-text-primary">Security</h1>
        <p className="text-text-secondary mt-2">Manage your password and authentication settings.</p>
      </div>

      <PasswordForm />
      <TwoFactorAuth />
    </div>
  )
}

function PasswordForm() {
  const [currentPassword, setCurrentPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")

  const { mutate, isPending } = useMutation({
    mutationFn: (data: any) => api.changePassword(data),
    onSuccess: () => {
      toast.success("Password changed successfully")
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
    },
    onError: () => {
      toast.error("Failed to change password")
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match")
      return
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters")
      return
    }
    mutate({ currentPassword, newPassword })
  }

  const isDirty = currentPassword && newPassword && confirmPassword

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="px-6 py-5 border-b border-border">
        <h3 className="text-lg font-medium text-text-primary">Change Password</h3>
      </div>
      
      <form onSubmit={handleSubmit} className="px-6 py-6 space-y-6 max-w-md">
        <div className="space-y-2">
          <label className="text-sm font-medium text-text-primary">Current password</label>
          <Input 
            type="password"
            value={currentPassword} 
            onChange={(e) => setCurrentPassword(e.target.value)} 
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-text-primary">New password</label>
          <Input 
            type="password"
            value={newPassword} 
            onChange={(e) => setNewPassword(e.target.value)} 
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-text-primary">Confirm new password</label>
          <Input 
            type="password"
            value={confirmPassword} 
            onChange={(e) => setConfirmPassword(e.target.value)} 
            required
          />
        </div>
        <div className="pt-4">
          <Button type="submit" disabled={!isDirty || isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Change password
          </Button>
        </div>
      </form>
    </div>
  )
}

function TwoFactorAuth() {
  const [enabled, setEnabled] = React.useState(false)

  const handleToggle = () => {
    if (!enabled) {
      alert("Authenticator app setup will be connected to the AlterX identity backend later.")
      setEnabled(true)
    } else {
      if (confirm("Are you sure you want to disable two-factor authentication?")) {
        setEnabled(false)
        toast.success("Two-factor authentication disabled")
      }
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="px-6 py-5 border-b border-border">
        <h3 className="text-lg font-medium text-text-primary">Two-Factor Authentication</h3>
      </div>
      <div className="px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-medium text-text-primary">Authenticator App</h4>
            <p className="text-sm text-text-secondary mt-1 max-w-md">
              Add an additional layer of security to your account by requiring a code from a mobile app when you log in.
            </p>
          </div>
          <Button variant={enabled ? "outline" : "primary"} onClick={handleToggle}>
            {enabled ? "Disable 2FA" : "Enable 2FA"}
          </Button>
        </div>
      </div>
    </div>
  )
}
