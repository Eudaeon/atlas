import { useEffect } from "react"

// A single-key → handler map. An undefined handler disables that key (e.g. a
// shortcut that's only live once data is loaded), so callers can pass a
// conditional without juggling the listener themselves.
export type Shortcuts = Record<string, (() => void) | undefined>

// Bind global single-key shortcuts. Modifier combos and key-repeats are ignored,
// and keystrokes are not intercepted while the user is typing in a field, so the
// shortcuts never fight with text entry. Keys are matched case-insensitively.
export function useKeyboardShortcuts(shortcuts: Shortcuts) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return

      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, textarea, select, [contenteditable='true']"))
      ) {
        return
      }

      const handler = shortcuts[event.key.toLowerCase()]
      if (handler) {
        event.preventDefault()
        handler()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [shortcuts])
}
