import { useEffect, useRef } from "react"

import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"

/** A two-value slider whose filled range drags as one window, at a fixed width.
Without this a grab between the thumbs jumps the nearer one, as base-ui does by
default. The behaviour lives here rather than in the shadcn slider, because
`shadcn add` rewrites that file and would take this with it.

ponytail: whole steps, so this assumes `step` is 1. Scale the shift by it if a
fractional slider ever wants a window. */
export function WindowSlider({
  className,
  value,
  min = 0,
  max = 100,
  onWindowDrag,
  ...props
}: Omit<React.ComponentProps<typeof Slider>, "value"> & {
  value: [number, number]
  onWindowDrag: (range: [number, number]) => void
}) {
  // Read through a ref: the listener is attached once, and the values change
  // under it as the drag reports back.
  const latest = useRef({ value, min, max, onWindowDrag })
  latest.current = { value, min, max, onWindowDrag }
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const indicator = host.current?.querySelector<HTMLElement>(
      "[data-slot=slider-range]"
    )
    if (indicator == null) return

    // The window follows the pointer one step per pixel of travel, so it has to
    // measure the same travel base-ui does: the track less one thumb, because
    // `thumbAlignment="edge"` keeps both thumbs inside the track.
    const start = (event: PointerEvent) => {
      // Touch is left alone: base-ui listens for `touchstart` on the control,
      // and that fires after `pointerdown` and would drag a thumb under the
      // window.
      if (event.button !== 0 || event.pointerType === "touch") return
      const control = indicator.closest<HTMLElement>(
        "[data-slot=slider-control]"
      )
      const thumb = control?.querySelector<HTMLElement>(
        "[data-slot=slider-thumb]"
      )
      if (control == null || thumb == null) return
      const travel = control.clientWidth - thumb.offsetWidth
      if (travel <= 0) return

      // Read once: the values change under it as the drag reports back.
      const {
        value: at,
        min: low,
        max: high,
        onWindowDrag: report,
      } = latest.current
      const width = at[1] - at[0]
      const startX = event.clientX
      const perPixel = (high - low) / travel
      // base-ui's own handler stands down on a prevented event, which is what
      // stops the grab from also moving a thumb.
      event.preventDefault()
      indicator.setPointerCapture(event.pointerId)
      const drag = new AbortController()
      const { signal } = drag
      indicator.addEventListener(
        "pointermove",
        (moved: PointerEvent) => {
          const shift = Math.round((moved.clientX - startX) * perPixel)
          const next = Math.min(Math.max(at[0] + shift, low), high - width)
          report([next, next + width])
        },
        { signal }
      )
      // Capture ends on pointerup and on cancel alike, so one listener covers
      // both ways the drag can finish.
      indicator.addEventListener("lostpointercapture", () => drag.abort(), {
        signal,
      })
    }

    indicator.addEventListener("pointerdown", start)
    return () => indicator.removeEventListener("pointerdown", start)
  }, [])

  return (
    <div
      ref={host}
      // The fill is the grab target: four pixels of track is not something
      // anyone can catch, so it reaches out above and below itself.
      className={cn(
        "[&_[data-slot=slider-range]]:cursor-grab",
        "[&_[data-slot=slider-range]]:after:absolute [&_[data-slot=slider-range]]:after:inset-x-0 [&_[data-slot=slider-range]]:after:-inset-y-2",
        "[&_[data-slot=slider-range]:active]:cursor-grabbing",
        className
      )}
    >
      <Slider value={value} min={min} max={max} {...props} />
    </div>
  )
}
