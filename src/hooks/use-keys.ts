import { useEffect, useRef } from "react"

/** Whether a key was going somewhere words are typed. A bare letter is a
shortcut in a page and a character in a box, and a textarea is as much a box as
an input is. */
const typingInto = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable)

/** A window-wide keyboard shortcut, told whether the key was going into a box:
most shortcuts stand down for that, and the ones held with ctrl do not. */
export function useKeys(
  onKey: (event: KeyboardEvent, typing: boolean) => void
) {
  // The listener goes on once and calls whatever the last render passed, so a
  // shortcut never acts on a view or a query that has moved on.
  const latest = useRef(onKey)
  latest.current = onKey
  useEffect(() => {
    const listener = (event: KeyboardEvent) =>
      latest.current(event, typingInto(event.target))
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [])
}
