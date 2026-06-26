import { useEffect, useState } from "react"

// Returns a copy of `value` that only updates after it has stayed unchanged for
// `delayMs`. Used to keep a high-frequency input (the timeline slider) visually
// responsive while deferring the expensive recompute it drives until the user
// settles. The setState runs inside a timeout (asynchronously), so it does not
// trip the set-state-in-effect lint.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])

  return debounced
}
