import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Moon, Sun, Monitor } from "lucide-react"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import { useTheme } from "@/components/theme-provider"
import { usePreferencesStore } from "@/features/settings/stores/usePreferencesStore"
import { type DisplayCurrency } from "@/api/types"

export function LanguageSettings() {
  const queryClient = useQueryClient()
  const { i18n } = useTranslation()
  const { theme, setTheme } = useTheme()
  const { currency, setCurrency } = usePreferencesStore()
  
  const { data: currentLanguage, isLoading } = useQuery({
    queryKey: queryKeys.settings.language,
    queryFn: () => api.getLanguage(),
  })
  
  const { mutate, isPending } = useMutation({
    mutationFn: (lang: string) => api.updateLanguage(lang).then(() => lang),
    onSuccess: (lang) => {
      queryClient.setQueryData(queryKeys.settings.language, lang)
      i18n.changeLanguage(lang === "hi-IN" ? "hi" : "en")
      toast.success("Language preference saved")
    }
  })

  const languages = [
    { code: "en-US", name: "English" },
    { code: "hi-IN", name: "Hindi" },
  ]

  const currencies: { code: DisplayCurrency, name: string, symbol: string }[] = [
    { code: "USD", name: "US Dollar", symbol: "$" },
    { code: "INR", name: "Indian Rupee", symbol: "₹" },
  ]

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-text-primary">Appearance & Region</h1>
        <p className="text-text-secondary mt-2">Customize how AlterX looks and formats data for you.</p>
      </div>

      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="px-6 py-5 border-b border-border">
          <h3 className="text-lg font-medium text-text-primary">Theme</h3>
          <p className="text-sm text-text-muted mt-1">Select your preferred color interface.</p>
        </div>
        <div className="px-6 py-6">
          <div className="grid grid-cols-3 gap-4 max-w-lg">
            <button
              onClick={() => setTheme("light")}
              className={`flex flex-col items-center justify-center gap-2 rounded-lg border p-4 transition-all focus:outline-none focus:ring-2 focus:ring-primary ${
                theme === "light" 
                  ? "border-primary bg-primary/5 text-primary ring-1 ring-primary" 
                  : "border-border bg-surface hover:border-border-strong hover:bg-surface-hover text-text-secondary"
              }`}
            >
              <Sun className="h-5 w-5" />
              <span className="font-medium text-sm">Light</span>
            </button>
            <button
              onClick={() => setTheme("dark")}
              className={`flex flex-col items-center justify-center gap-2 rounded-lg border p-4 transition-all focus:outline-none focus:ring-2 focus:ring-primary ${
                theme === "dark" 
                  ? "border-primary bg-primary/5 text-primary ring-1 ring-primary" 
                  : "border-border bg-surface hover:border-border-strong hover:bg-surface-hover text-text-secondary"
              }`}
            >
              <Moon className="h-5 w-5" />
              <span className="font-medium text-sm">Dark</span>
            </button>
            <button
              onClick={() => setTheme("system")}
              className={`flex flex-col items-center justify-center gap-2 rounded-lg border p-4 transition-all focus:outline-none focus:ring-2 focus:ring-primary ${
                theme === "system" 
                  ? "border-primary bg-primary/5 text-primary ring-1 ring-primary" 
                  : "border-border bg-surface hover:border-border-strong hover:bg-surface-hover text-text-secondary"
              }`}
            >
              <Monitor className="h-5 w-5" />
              <span className="font-medium text-sm">System</span>
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="px-6 py-5 border-b border-border">
          <h3 className="text-lg font-medium text-text-primary">Display Currency</h3>
          <p className="text-sm text-text-muted mt-1">Select the currency for billing, costs, and marketplace pricing.</p>
        </div>
        <div className="px-6 py-6">
          <div className="grid gap-3 max-w-md">
            {currencies.map((curr) => (
              <button
                key={curr.code}
                onClick={() => setCurrency(curr.code)}
                className={`flex items-center justify-between rounded-lg border p-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                  currency === curr.code 
                    ? "border-primary bg-primary/5 text-primary" 
                    : "border-border bg-surface hover:border-border-strong hover:bg-surface-hover text-text-secondary"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-raised font-mono text-sm border border-border">
                    {curr.symbol}
                  </span>
                  <span className="font-medium text-sm">{curr.name}</span>
                </div>
                {currency === curr.code && (
                  <span className="text-xs font-semibold uppercase tracking-wider text-primary">Active</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="px-6 py-5 border-b border-border">
          <h3 className="text-lg font-medium text-text-primary">Language Preference</h3>
          <p className="text-sm text-text-muted mt-1">Choose the language you prefer for the AlterX interface.</p>
        </div>
        
        <div className="px-6 py-6">
          {isLoading ? (
            <div className="flex justify-center p-4">
              <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
            </div>
          ) : (
            <div className="grid gap-3 max-w-md">
              {languages.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => mutate(lang.code)}
                  disabled={isPending}
                  className={`flex items-center justify-between rounded-lg border p-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                    currentLanguage === lang.code 
                      ? "border-primary bg-primary/5 text-primary" 
                      : "border-border bg-surface hover:border-border-strong hover:bg-surface-hover text-text-secondary"
                  }`}
                >
                  <span className="font-medium text-sm">{lang.name}</span>
                  {currentLanguage === lang.code && (
                    <span className="text-xs font-semibold uppercase tracking-wider text-primary">Active</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
