import { Moon, Sun } from "lucide-react"

import { useTheme } from "@/providers/theme-provider"
import { FloatingButton } from "@/features/app-shell/floating-button"

// The fixed top-right light/dark toggle. Mirrors the "T" keyboard shortcut.
export function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme()
  return (
    <FloatingButton
      className="fixed top-4 right-4 z-50"
      aria-label="Toggle theme"
      title="Toggle theme (T)"
      onClick={toggleTheme}
    >
      {resolvedTheme === "dark" ? <Sun /> : <Moon />}
    </FloatingButton>
  )
}
