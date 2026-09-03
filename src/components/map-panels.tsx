import {
  IconAdjustmentsHorizontal,
  IconCheck,
  IconClock,
  IconUsers,
} from "@tabler/icons-react"
import type { ReactNode } from "react"

import { cn, scrolls } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { WindowSlider } from "@/components/window-slider"
import { many } from "@/lib/analysis"
import { localTime } from "@/lib/entra-logs"
import { selectedCount } from "@/lib/facets"
import type { Facet, FacetValue } from "@/lib/facets"

/** One user as the panel lists them: their colour and how much of the map is
theirs. */
export type Person = {
  user: string
  name: string
  count: number
  color: string
}

type Side = "left" | "right" | "bottom"

// The tab sits against the middle of the panel's inner edge and rides with it,
// so a collapsed panel leaves only its tab on screen. It laps 1px over that
// edge to cover the panel's own border at the seam.
const place: Record<Side, string> = {
  left: "top-1/2 left-full -translate-y-1/2 -ml-px",
  right: "top-1/2 right-full -translate-y-1/2 -mr-px",
  bottom: "bottom-full left-1/2 -translate-x-1/2 -mb-px",
}

// Round the outer corners only, and drop the border where it meets the panel,
// so the tab reads as a flap off the panel rather than a box beside it.
const shape: Record<Side, string> = {
  left: "rounded-r-xl border-l-0",
  right: "rounded-l-xl border-r-0",
  bottom: "rounded-t-xl border-b-0",
}

// The label runs along the edge, reading toward the panel.
const writing: Record<Side, string> = {
  left: "[writing-mode:vertical-rl]",
  right: "[writing-mode:vertical-rl] rotate-180",
  bottom: "",
}

/** The flap on a panel's outer edge that folds it away. */
function PanelTab({
  side,
  label,
  icon,
  open,
  toggle,
  shortcut,
}: {
  side: Side
  label: string
  icon: ReactNode
  open: boolean
  toggle: () => void
  shortcut: string
}) {
  const upright = side !== "bottom"
  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={open}
      data-over-map
      title={`${open ? "Collapse" : "Expand"} ${label.toLowerCase()} (${shortcut})`}
      className={cn(
        "absolute z-10 flex items-center justify-center gap-1.5 border bg-popover text-popover-foreground transition-colors hover:bg-muted",
        // One length for every tab, whatever its label says.
        upright ? "h-32 flex-col px-1.5 py-3" : "w-32 flex-row px-3 py-1.5",
        place[side],
        shape[side],
        // Open, the panel's own shadow already traces the tab.
        !open && "drop-shadow-xl"
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span
        className={cn(
          "text-[11px] font-semibold tracking-wide whitespace-nowrap",
          writing[side]
        )}
      >
        {label}
      </span>
    </button>
  )
}

/** The surface the map's own panels are drawn on, so a panel reads as one
thing floating over the map rather than as part of the page under it. */
const floating = "bg-popover text-popover-foreground ring-1 ring-foreground/10"

const panel = cn(
  "fixed z-20 flex flex-col rounded-2xl transition-transform duration-300 ease-out",
  floating
)

// The flap is centred on the panel's edge, so a short panel runs it into the
// rounded corners. The floor is the flap (h-32) plus a rounded-2xl corner
// above and below it, which is 1.8 radii each.
const sidePanel = cn(
  panel,
  "top-1/2 max-h-[70vh] min-h-[calc(8rem_+_var(--radius)_*_3.6)] w-64 -translate-y-1/2"
)

/** Select all / Deselect all, as a line of text rather than another button. */
function SelectAll({
  all,
  onClick,
  className,
}: {
  all: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-left text-xs font-medium text-primary hover:text-primary/80",
        className
      )}
    >
      {all ? "Deselect all" : "Select all"}
    </button>
  )
}

/** Everyone on the map, busiest first. Clicking one takes them off it. */
export function UsersPanel({
  users,
  hidden,
  toggle,
  toggleAll,
  open,
  toggleOpen,
}: {
  users: Array<Person>
  hidden: ReadonlySet<string>
  toggle: (user: string) => void
  toggleAll: (select: boolean) => void
  open: boolean
  toggleOpen: () => void
}) {
  const shown = users.length - hidden.size
  const all = hidden.size === 0

  return (
    <div
      data-over-map
      className={cn(
        sidePanel,
        "left-0",
        open ? "translate-x-4 shadow-lg" : "-translate-x-full"
      )}
    >
      <PanelTab
        side="left"
        label="USERS"
        icon={<IconUsers className="size-4" />}
        open={open}
        toggle={toggleOpen}
        shortcut="1"
      />
      <div className="flex flex-col gap-1 px-3 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium">Users</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {shown} of {users.length}
          </span>
        </div>
        <SelectAll
          all={all}
          onClick={() => toggleAll(!all)}
          className="self-start"
        />
      </div>
      <div className="flex flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {users.map((user) => {
          const off = hidden.has(user.user)
          return (
            <button
              key={user.user}
              type="button"
              onClick={() => toggle(user.user)}
              aria-pressed={!off}
              className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-muted"
            >
              <span
                className={cn(
                  "size-2.5 shrink-0 rounded-full ring-1 ring-black/10",
                  off && "opacity-30"
                )}
                style={{ backgroundColor: user.color }}
              />
              <span
                className={cn(
                  "flex min-w-0 flex-1 flex-col",
                  off && "text-muted-foreground line-through"
                )}
              >
                <span className={cn("text-xs font-medium", scrolls)}>
                  {user.name}
                </span>
                {user.user === user.name ? null : (
                  <span
                    className={cn("text-xs text-muted-foreground", scrolls)}
                  >
                    {user.user}
                  </span>
                )}
              </span>
              <Badge variant="secondary" className="shrink-0">
                {user.count}
              </Badge>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Values({
  values,
  deselected,
  toggle,
}: {
  values: Array<FacetValue>
  deselected: ReadonlySet<string>
  toggle: (key: string, on: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {values.map(({ key, value, count }) => {
        const on = !deselected.has(key)
        return (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key, on)}
            aria-pressed={on}
            className="flex items-center gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-muted"
          >
            <span
              className={cn(
                "flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border",
                on
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/40"
              )}
            >
              {on ? <IconCheck className="size-2.5" /> : null}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1",
                scrolls,
                !on && "text-muted-foreground line-through"
              )}
            >
              {value}
            </span>
            <Badge variant="secondary" className="shrink-0">
              {count}
            </Badge>
          </button>
        )
      })}
    </div>
  )
}

/** What the connections on the map have in common, each value a switch. */
export function CategoriesPanel({
  facets,
  deselected,
  toggle,
  toggleAll,
  open,
  toggleOpen,
}: {
  facets: Array<Facet>
  deselected: ReadonlySet<string>
  toggle: (key: string, on: boolean) => void
  toggleAll: (values: Array<FacetValue>, select: boolean) => void
  open: boolean
  toggleOpen: () => void
}) {
  return (
    <div
      data-over-map
      className={cn(
        sidePanel,
        "right-0",
        open ? "-translate-x-4 shadow-lg" : "translate-x-full"
      )}
    >
      <PanelTab
        side="right"
        label="CATEGORIES"
        icon={<IconAdjustmentsHorizontal className="size-4" />}
        open={open}
        toggle={toggleOpen}
        shortcut="2"
      />
      <div className="px-3 pt-3 pb-2">
        <span className="text-xs font-medium">Categories</span>
      </div>
      <div className="overflow-y-auto px-2 pb-2">
        <Accordion className="rounded-none border-0">
          {facets.map((facet) => {
            const selected = selectedCount(facet.values, deselected)
            const all = selected === facet.values.length
            return (
              <AccordionItem key={facet.label} value={facet.label}>
                <AccordionTrigger className="items-center px-2 py-2 hover:no-underline">
                  <span className="flex flex-1 items-center justify-between gap-2">
                    {facet.label}
                    <Badge variant="secondary" className="tabular-nums">
                      {selected}/{facet.values.length}
                    </Badge>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="px-1 pb-2">
                  <SelectAll
                    all={all}
                    onClick={() => toggleAll(facet.values, !all)}
                    className="mb-0.5 px-2 py-1"
                  />
                  <Values
                    values={facet.values}
                    deselected={deselected}
                    toggle={toggle}
                  />
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      </div>
    </div>
  )
}

/** A window over the connections in time. Each step is one connection, so the
ends read as the timestamps they sit on. */
export function Timeline({
  connections,
  range,
  count,
  onRange,
  open,
  toggleOpen,
}: {
  /** The connections in time order. Only the length and the two ends are read,
  so this takes the rows themselves rather than a list of their dates: building
  that list is one array the length of the dataset, and this rerenders on every
  frame of a pan. */
  connections: ReadonlyArray<{ Date: string }>
  range: [number, number]
  count: number
  onRange: (range: [number, number]) => void
  open: boolean
  toggleOpen: () => void
}) {
  const [low, high] = range
  return (
    <div
      data-over-map
      className={cn(
        panel,
        "bottom-0 left-1/2 w-[28rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 p-4",
        open ? "-translate-y-4 shadow-lg" : "translate-y-full"
      )}
    >
      <PanelTab
        side="bottom"
        label="TIMELINE"
        icon={<IconClock className="size-4" />}
        open={open}
        toggle={toggleOpen}
        shortcut="3"
      />
      <div className="mb-3 flex items-center justify-between text-xs">
        <span className="font-medium">Timeline</span>
        <span className="text-muted-foreground tabular-nums">
          {many(count, "connection")}
        </span>
      </div>
      <WindowSlider
        min={0}
        max={connections.length - 1}
        step={1}
        value={[low, high]}
        onValueChange={(value) => {
          const next = Array.isArray(value) ? value : [value, value]
          onRange([next[0], next[1]])
        }}
        onWindowDrag={onRange}
      />
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="truncate">
          {localTime(connections[low]?.Date ?? "")}
        </span>
        <span className="truncate text-right">
          {localTime(connections[high]?.Date ?? "")}
        </span>
      </div>
    </div>
  )
}
