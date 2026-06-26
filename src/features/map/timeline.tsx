import { Clock } from "lucide-react"

import { cn } from "@/lib/utils"
import type { SignIn } from "@/lib/signin"
import { formatDate, quantity } from "@/lib/format"
import { PanelTab } from "@/features/map/panel-tab"
import { Slider } from "@/components/ui/slider"

type TimelineProps = {
  rows: SignIn[]
  range: [number, number]
  // Connections passing every active filter (timeline, users, categories).
  count: number
  onRangeChange: (range: [number, number]) => void
  open: boolean
  onToggleOpen: () => void
}

const TAB_ICON = <Clock className="size-4" />

// A double-thumb range slider over the time-sorted connections. Each step is one
// connection, so the labels show the timestamp at each thumb.
export function Timeline({
  rows,
  range,
  count,
  onRangeChange,
  open,
  onToggleOpen,
}: TimelineProps) {
  const [lo, hi] = range

  return (
    <div
      className={cn(
        "absolute bottom-0 left-1/2 z-10 w-[28rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/5 transition-transform duration-300 ease-out dark:ring-foreground/10",
        open ? "-translate-y-4 shadow-lg" : "translate-y-full"
      )}
    >
      <PanelTab
        side="bottom"
        label="TIMELINE"
        icon={TAB_ICON}
        open={open}
        onToggle={onToggleOpen}
        shortcut="3"
      />
      <div className="mb-3 flex items-center justify-between text-xs">
        <span className="font-medium">Timeline</span>
        <span className="text-muted-foreground">
          Showing {quantity(count, "connection")}
        </span>
      </div>
      <Slider
        min={0}
        max={rows.length - 1}
        step={1}
        value={[lo, hi]}
        onValueChange={(value) => {
          const next = Array.isArray(value) ? value : [value, value]
          onRangeChange([next[0], next[1]])
        }}
      />
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="truncate">
          {formatDate(rows[lo]?.createdDateTime)}
        </span>
        <span className="truncate text-right">
          {formatDate(rows[hi]?.createdDateTime)}
        </span>
      </div>
    </div>
  )
}
