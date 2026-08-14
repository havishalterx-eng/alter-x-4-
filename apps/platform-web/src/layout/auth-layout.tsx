import { Outlet, Navigate } from "react-router-dom"
import { SquareTerminal } from "lucide-react"
import { useAuth } from "@/features/auth/hooks/useAuth"

export function AuthLayout() {
  const { isAuthenticated } = useAuth()

  // If already logged in, redirect to dashboard
  if (isAuthenticated) {
    return <Navigate to="/app/dashboard" replace />
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ax-bg px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col items-center justify-center text-center">
        <div className="mb-6 flex items-center justify-center rounded-full bg-primary/10 p-3">
          <SquareTerminal className="h-10 w-10 text-primary" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-text-primary">
          AlterX
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          Build intelligent workflows.<br />
          Operate autonomous agents.<br />
          Keep humans in control.
        </p>
      </div>

      <div className="w-full max-w-md">
        <Outlet />
      </div>
    </div>
  )
}
