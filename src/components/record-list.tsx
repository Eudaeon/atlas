import { useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { VirtualItem } from "@tanstack/react-virtual"
import { IconEye } from "@tabler/icons-react"

import { cn, scrolls } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { RecordDetails } from "@/components/detail-popover"
import { userOf } from "@/lib/connection-points"
import { localTime, statusVariant } from "@/lib/entra-logs"
import type { LogRow } from "@/lib/entra-logs"

// What the Analysis and Sessions lists are both made of: a record as one line,
// the eye that takes it to the map, and the tally on a filter. Here rather than
// in whichever of the two views happened to want it first.

/** The pair of spacers standing in for the rows or columns either side of the
mounted range. Same arithmetic down the table as across it, and down the record
lists under a finding. With nothing mounted the whole list is spacer: a scroller
sized by its content has no height until something stands in for the rows, and
with no height it mounts nothing. */
export const spacers = (
  items: Array<VirtualItem>,
  total: number
): [number, number] =>
  items.length === 0
    ? [0, total]
    : [items[0].start, total - items[items.length - 1].end]

/** The frame a run of `Line`s sits in. The lines borrow its columns, so an
address four times longer than the one above it moves nothing: every date, every
address and every activity down the list starts at the same place. The gap
between lines is the padding under each one rather than a row gap, because a gap
is not part of a line and the mounted range is measured a line at a time. */
const lines = "grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-x-2"

/** A collapsed line: text, its padding, and the border. Only the estimate the
range is picked with; an opened line carries the whole record under it and is
measured. */
const lineHeight = 34

/** The eye that takes a row to the map with the search that pulls its records
back up. It is laid over the row's trigger rather than sat inside it, because a
button inside a button is not a thing: the row still opens on a click anywhere
else, and the eye is measured against the row rather than the open item. Give
the trigger `relative` and room on its right. */
export function ShowOnMap({ onShow }: { onShow: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Show on the map"
            className="absolute top-1/2 right-8 -translate-y-1/2"
            onClick={onShow}
          />
        }
      >
        <IconEye />
      </TooltipTrigger>
      <TooltipContent>Show on the map</TooltipContent>
    </Tooltip>
  )
}

/** One record as a line: when, who, from where, and what they did. The line is
the summary; it opens onto the whole record, because the four things worth
listing are never the four the next question is about. */
function Line({ row }: { row: LogRow }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          "col-span-5 grid grid-cols-subgrid items-center rounded-lg border px-2 py-1.5 text-left text-xs hover:bg-muted/50",
          open && "rounded-b-none bg-muted/50"
        )}
      >
        <span className="text-muted-foreground tabular-nums">
          {localTime(row.Date)}
        </span>
        <span className={cn("min-w-0", scrolls)}>{userOf(row)}</span>
        <span className="text-muted-foreground tabular-nums">
          {row["IP Address"]}
        </span>
        <span className={cn("min-w-0", scrolls)}>
          {row.Activity || row.Application}
        </span>
        {row.Status === "" ? null : (
          <Badge variant={statusVariant(row.Status)}>{row.Status}</Badge>
        )}
      </button>
      {open ? (
        // Hung off the line above rather than boxed on its own: a border of its
        // own would read as two things.
        <div className="col-span-5 rounded-b-lg border border-t-0 px-2 pt-1 pb-2">
          <RecordDetails row={row} />
        </div>
      ) : null}
    </>
  )
}

/** The records a finding or a session was read off. All of them are listed and
only the ones on screen are mounted: a flagged address can carry thousands, and
the point of the list is to show what the finding was read off rather than to be
the table again. */
export function Lines({ rows }: { rows: Array<LogRow> }) {
  const box = useRef<HTMLDivElement>(null)
  const list = useVirtualizer({
    count: rows.length,
    getScrollElement: () => box.current,
    estimateSize: () => lineHeight,
    overscan: 10,
  })
  const visible = list.getVirtualItems()
  const [padTop, padBottom] = spacers(visible, list.getTotalSize())
  return (
    <div ref={box} className="max-h-96 overflow-y-auto">
      <div className={lines}>
        <div className="col-span-5" style={{ height: padTop }} />
        {visible.map((item) => (
          <div
            key={rows[item.index]["Record ID"] || item.index}
            data-index={item.index}
            // Measured rather than pinned: opening a line hangs the whole
            // record under it, and the range below has to move down by however
            // tall that record is.
            ref={list.measureElement}
            className="col-span-5 grid grid-cols-subgrid pb-1"
          >
            <Line row={rows[item.index]} />
          </div>
        ))}
        <div className="col-span-5" style={{ height: padBottom }} />
      </div>
    </div>
  )
}

/** The tally beside a filter's name. */
export const Count = ({ of }: { of: number }) => (
  <span className="text-muted-foreground tabular-nums">
    {of.toLocaleString()}
  </span>
)
