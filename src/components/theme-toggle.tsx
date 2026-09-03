import { useEffect, useState } from "react"
import { IconMoon, IconSun } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/** Runs before paint in the document head, so the first render isn't a flash. */
export const themeScript = `document.documentElement.classList.toggle("dark",
  localStorage.theme === "dark" ||
    (!localStorage.theme && matchMedia("(prefers-color-scheme: dark)").matches))`

export function ThemeToggle() {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"))
  }, [])

  function toggle() {
    const next = !dark
    document.documentElement.classList.toggle("dark", next)
    localStorage.theme = next ? "dark" : "light"
    setDark(next)
  }

  const label = dark ? "Switch to light theme" : "Switch to dark theme"

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            onClick={toggle}
          >
            {dark ? <IconSun /> : <IconMoon />}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
