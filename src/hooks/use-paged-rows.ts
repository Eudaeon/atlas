import { useEffect, useRef, useState } from "react"
import type { RefObject } from "react"

// Rows mount a page at a time. The scrollbar only ever covers the pages that
// are already there, so running off the end stops the scroll rather than
// showing blank space, and the next page extends it a frame later.
const pageSize = 200

/**
 * How many of `total` rows to mount. Grows by a page whenever the scroll comes
 * within a screen of the end, and drops back to one page when `resetKey`
 * changes, scrolling the element back to the top.
 */
export function usePagedRows(
  scroller: RefObject<HTMLElement | null>,
  total: number,
  resetKey: unknown
) {
  const [limit, setLimit] = useState(pageSize)
  const loading = useRef(false)
  const frame = useRef(0)
  const ready = Math.min(limit, total)

  // A new file or a new query starts the paging over from the top.
  useEffect(() => {
    cancelAnimationFrame(frame.current)
    loading.current = false
    setLimit(pageSize)
    scroller.current?.scrollTo({ top: 0 })
    return () => cancelAnimationFrame(frame.current)
  }, [resetKey, scroller])

  useEffect(() => {
    loading.current = false
  }, [ready])

  // Listens on the element rather than watching the mounted range, which stops
  // changing once the overscan already covers every remaining row.
  useEffect(() => {
    const el = scroller.current
    if (!el || ready >= total) return

    const below = () => el.scrollHeight - el.scrollTop - el.clientHeight
    const load = () => {
      if (loading.current) return
      loading.current = true
      // Two frames, so the rows from the last page are laid out before the next
      // decision. Measuring straight away sees the old height and asks for
      // another page, and the whole file mounts in one blocking burst.
      frame.current = requestAnimationFrame(() => {
        frame.current = requestAnimationFrame(() =>
          setLimit((current) => Math.min(current + pageSize, total))
        )
      })
    }

    // One screen of lookahead. Less than that and a slow scroll walls constantly.
    const check = () => {
      if (below() <= el.clientHeight) load()
    }
    // A scroll that has run out of rows moves nothing, so the browser fires no
    // scroll event and the wall goes unnoticed. The wheel still fires, and it
    // is the only signal that someone is pushing against the end.
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY > 0 && below() <= 2) load()
    }

    // Covers the case where the page just loaded does not fill the viewport.
    check()
    el.addEventListener("scroll", check, { passive: true })
    el.addEventListener("wheel", onWheel, { passive: true })
    return () => {
      el.removeEventListener("scroll", check)
      el.removeEventListener("wheel", onWheel)
    }
  }, [ready, total, scroller])

  return ready
}
