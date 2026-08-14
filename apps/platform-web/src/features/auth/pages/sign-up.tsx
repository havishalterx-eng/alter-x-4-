import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Link, useNavigate } from "react-router-dom"
import { signUpSchema, type SignUpFormValues } from "../schemas"
import { useAuth } from "../hooks/useAuth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { delay } from "@/api/mock/data"

export function SignUp() {
  const navigate = useNavigate()
  const { signIn } = useAuth()
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const form = useForm<SignUpFormValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  })

  async function onSubmit() {
    setIsSubmitting(true)
    // Simulate API call
    await delay(800)
    signIn()
    navigate("/app/dashboard")
    setIsSubmitting(false)
  }

  return (
    <Card>
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl">Create account</CardTitle>
        <CardDescription>
          Join AlterX to start building intelligent workflows
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Full name</Label>
            <Input
              id="name"
              placeholder="Alice Smith"
              disabled={isSubmitting}
              error={!!form.formState.errors.name}
              {...form.register("name")}
            />
            <div className="min-h-[20px]">
              {form.formState.errors.name && (
                <p className="text-sm text-danger">{form.formState.errors.name.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Work email</Label>
            <Input
              id="email"
              placeholder="alice@company.com"
              type="email"
              disabled={isSubmitting}
              error={!!form.formState.errors.email}
              {...form.register("email")}
            />
            <div className="min-h-[20px]">
              {form.formState.errors.email && (
                <p className="text-sm text-danger">{form.formState.errors.email.message}</p>
              )}
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              disabled={isSubmitting}
              error={!!form.formState.errors.password}
              {...form.register("password")}
            />
            <div className="min-h-[20px]">
              {form.formState.errors.password && (
                <p className="text-sm text-danger">{form.formState.errors.password.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input
              id="confirmPassword"
              type="password"
              disabled={isSubmitting}
              error={!!form.formState.errors.confirmPassword}
              {...form.register("confirmPassword")}
            />
            <div className="min-h-[20px]">
              {form.formState.errors.confirmPassword && (
                <p className="text-sm text-danger">{form.formState.errors.confirmPassword.message}</p>
              )}
            </div>
          </div>

          <Button className="w-full mt-6" type="submit" loading={isSubmitting}>
            Create account
          </Button>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-surface px-2 text-text-muted">
              Or continue with
            </span>
          </div>
        </div>

        <Button variant="outline" type="button" className="w-full" disabled={isSubmitting}>
          Google
        </Button>
      </CardContent>
      <CardFooter className="flex flex-col text-center">
        <p className="text-sm text-text-muted">
          Already have an account?{" "}
          <Link
            to="/auth/sign-in"
            className="font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-sm"
          >
            Sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  )
}
