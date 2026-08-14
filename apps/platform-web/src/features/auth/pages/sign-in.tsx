import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { useAuth } from "../hooks/useAuth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

export function SignIn() {
  const navigate = useNavigate()
  const { signIn } = useAuth()
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  async function onSignIn() {
    setIsSubmitting(true)
    try {
      await signIn()
      navigate("/app/dashboard")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl">Sign in</CardTitle>
        <CardDescription>
          Continue with Google to access your workspace
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          type="button"
          className="w-full"
          loading={isSubmitting}
          onClick={onSignIn}
        >
          Continue with Google
        </Button>
      </CardContent>
      <CardFooter className="flex flex-col text-center">
        <p className="text-sm text-text-muted">
          Don't have an account?{" "}
          <Link
            to="/auth/sign-up"
            className="font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-sm"
          >
            Create account
          </Link>
        </p>
      </CardFooter>
    </Card>
  )
}
