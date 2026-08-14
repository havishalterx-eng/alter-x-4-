import * as React from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { completeLogin } from "@/api/auth"
import { useAuth } from "../hooks/useAuth"

export function AuthCallback() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [error, setError] = React.useState<string | null>(null)
  const startedRef = React.useRef(false)

  React.useEffect(() => {
    let active = true

    async function finish() {
      // React 18 StrictMode double-invokes effects in dev, and the OAuth
      // code/state in the URL don't change between the two runs -- without
      // this guard, completeLogin() fires twice with two different
      // idempotency keys (mutationKey() is random per call), so the backend
      // can't dedupe them and ends up creating two real accounts.
      if (startedRef.current) return
      startedRef.current = true
      try {
        await completeLogin({
          code: params.get("code"),
          state: params.get("state"),
        })
        await refresh()
        if (active) navigate("/app/dashboard", { replace: true })
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Sign-in failed")
      }
    }

    void finish()
    return () => {
      active = false
    }
  }, [navigate, params, refresh])

  return (
    <div className="rounded-md border border-border bg-surface p-6 text-center text-sm text-text-secondary">
      {error ? error : "Completing sign-in..."}
    </div>
  )
}
