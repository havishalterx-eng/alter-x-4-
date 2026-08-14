import { Outlet, Navigate, useLocation } from "react-router-dom"
import { useEffect } from "react"
import { Sidebar } from "./sidebar"
import { Topbar } from "./topbar"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { useOnboarding } from "@/features/onboarding/hooks/useOnboarding"
import { isLiveApi } from "@/api/http"

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    // Instant scroll to top on route change (NOT smooth — per spec)
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior })
  }, [pathname])
  return null
}

export function AppShell() {
  const { isAuthenticated, validated, validate } = useAuth()
  const { completed } = useOnboarding()
  const location = useLocation()

  useEffect(() => {
    if (isLiveApi && !validated) {
      void validate()
    }
  }, [validated, validate])

  // Wait for the real cookie to be confirmed against the backend before
  // trusting the localStorage flag -- it only records that sign-in once
  // succeeded, not that the session is still valid right now.
  if (isLiveApi && !validated) {
    return null
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth/sign-in" state={{ from: location }} replace />
  }

  if (!completed) {
    return <Navigate to="/onboarding" replace />
  }

  return (
    <div className="flex h-screen w-full flex-col md:flex-row overflow-hidden bg-ax-bg">
      <ScrollToTop />
      <Sidebar className="hidden md:flex" />
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-auto ax-scroll-container" id="main-content">
          <div className="mx-auto max-w-7xl h-full p-4 md:p-8 ax-page-enter" key={location.pathname}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
