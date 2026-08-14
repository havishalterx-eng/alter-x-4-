import * as React from "react"
import { Search, HelpCircle, Menu, Command, Sun, Moon, Monitor } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer"
import { Sidebar } from "./sidebar"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { useTheme } from "@/components/theme-provider"
import { GlobalSearchModal } from "@/features/search/components/global-search-modal"
import { NotificationPopover } from "@/features/notifications/components/notification-popover"
import { KeyboardShortcutsDialog } from "@/features/commands/components/keyboard-shortcuts-dialog"
import { useTranslation } from "react-i18next"

function initials(value: string | undefined) {
  if (!value) return "AX"
  const parts = value.split(/[\s@.]+/).filter(Boolean)
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "AX"
}

export function Topbar() {
  const { signOut, user } = useAuth()
  const { setTheme } = useTheme()
  const { t, i18n } = useTranslation("common")
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false)

  const toggleLanguage = () => {
    const nextLang = i18n.language === "en" ? "hi" : "en"
    i18n.changeLanguage(nextLang)
    localStorage.setItem("alterx_lang", nextLang)
  }

  // Setup Cmd+K / Ctrl+K shortcut
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-4 border-b border-ax-border bg-ax-shell/80 px-4 backdrop-blur-md sm:gap-6 sm:px-6">
      <Drawer open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <DrawerTrigger asChild>
          <button className="md:hidden text-text-muted hover:text-text-primary">
            <Menu className="h-5 w-5" />
          </button>
        </DrawerTrigger>
        <DrawerContent side="left" className="p-0 w-64">
          <Sidebar className="w-full border-r-0" />
        </DrawerContent>
      </Drawer>

      <div className="flex flex-1 items-center gap-4 md:ml-auto md:gap-2 lg:gap-4">
        <div className="flex-1 sm:flex-initial w-full sm:w-80">
          <button 
            onClick={() => setSearchOpen(true)}
            className="flex w-full items-center justify-between rounded-md border border-ax-border bg-ax-surface-1 px-3 py-1.5 text-sm text-ax-text-muted shadow-sm hover:border-ax-border-strong hover:bg-ax-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary transition-all duration-300"
          >
            <span className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              <span>{t("topbar.search", "Search...")}</span>
            </span>
            <span className="flex items-center gap-0.5 text-xs">
              <Command className="h-3 w-3" />
              <span>K</span>
            </span>
          </button>
        </div>

        <div className="ml-auto flex items-center gap-4">
          <NotificationPopover />
          <button className="text-text-muted hover:text-text-primary transition-colors hidden sm:block">
            <HelpCircle className="h-5 w-5" />
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary/20 text-primary text-xs font-semibold">
                    {initials(user?.name ?? user?.email)}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="flex flex-col space-y-1 p-2">
                <p className="text-sm font-medium leading-none">{user?.name || user?.email || "Signed in"}</p>
                <p className="text-xs leading-none text-text-muted">
                  {user?.email ?? ""}
                </p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem>{t("topbar.profile", "Profile")}</DropdownMenuItem>
              <DropdownMenuItem>{t("topbar.settings", "Settings")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShortcutsOpen(true)}>{t("topbar.shortcuts", "Keyboard shortcuts")}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setTheme("light")} className="gap-2"><Sun className="h-4 w-4" />{t("topbar.themeLight", "Light")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")} className="gap-2"><Moon className="h-4 w-4" />{t("topbar.themeDark", "Dark")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")} className="gap-2"><Monitor className="h-4 w-4" />{t("topbar.themeSystem", "System")}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={toggleLanguage}>
                {i18n.language === "en" ? "Switch to Hindi (हिन्दी)" : "Switch to English"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut} className="text-danger focus:bg-danger/10 focus:text-danger">
                {t("topbar.signOut", "Sign out")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <GlobalSearchModal open={searchOpen} onOpenChange={setSearchOpen} />
      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </header>
  )
}
