import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

type Side = "left" | "right" | "bottom"

// The tab sits against the middle of the panel's inner border. The panel itself
// slides off-screen when collapsed, carrying the tab to the screen edge — so the
// tab's position relative to the panel never changes.
// Pull the tab 1px over the panel's edge so it covers the panel's own border at
// the seam — without this overlap, that border draws a line between the two.
const POSITION: Record<Side, string> = {
  left: "top-1/2 left-full -translate-y-1/2 -ml-px",
  right: "top-1/2 right-full -translate-y-1/2 -mr-px",
  bottom: "bottom-full left-1/2 -translate-x-1/2 -mb-px",
}

// Round only the outer corners so the tab reads as a flap off the panel edge.
const ROUNDING: Record<Side, string> = {
  left: "rounded-r-xl",
  right: "rounded-l-xl",
  bottom: "rounded-t-xl",
}

// Drop the border on the side that meets the panel so the tab reads as one
// continuous flap with it. The tab carries no shadow of its own — the panel's
// drop-shadow filter traces the combined silhouette (panel + tab) as one shape.
const SEAM: Record<Side, string> = {
  left: "border-l-0",
  right: "border-r-0",
  bottom: "border-b-0",
}

// The label runs along the edge, reading toward the panel: top-to-bottom on the
// left, bottom-to-top on the right, and upright on the bottom.
const TEXT: Record<Side, string> = {
  left: "[writing-mode:vertical-rl]",
  right: "[writing-mode:vertical-rl] rotate-180",
  bottom: "",
}

type PanelTabProps = {
  side: Side
  label: string
  icon: ReactNode
  open: boolean
  onToggle: () => void
  // Keyboard shortcut that also toggles this panel; appended to the tooltip.
  shortcut?: string
}

// A "languette": a small flap on a panel's outer edge that expands or collapses
// it, carrying the panel's icon and label with the label written along the edge.
export function PanelTab({
  side,
  label,
  icon,
  open,
  onToggle,
  shortcut,
}: PanelTabProps) {
  const vertical = side !== "bottom"
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      title={`${open ? "Collapse" : "Expand"} ${label.toLowerCase()}${
        shortcut ? ` (${shortcut})` : ""
      }`}
      className={cn(
        "absolute z-10 flex items-center justify-center gap-1.5 border bg-popover text-popover-foreground transition-colors hover:bg-muted",
        // A fixed length on the long axis so every tab is the same size
        // regardless of its label's length (e.g. USERS vs CATEGORIES).
        vertical ? "h-32 flex-col px-1.5 py-3" : "w-32 flex-row px-3 py-1.5",
        ROUNDING[side],
        SEAM[side],
        POSITION[side],
        // When collapsed the panel drops its shadow (it's off-screen and would
        // otherwise bleed back onto the edge), so the tab carries its own here.
        // When open the panel's drop-shadow already traces the tab.
        !open && "drop-shadow-xl"
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span
        className={cn(
          "text-[11px] font-semibold tracking-wide whitespace-nowrap",
          TEXT[side]
        )}
      >
        {label}
      </span>
    </button>
  )
}
