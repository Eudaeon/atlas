import { useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  columnVisibilityFeature,
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import type { ColumnVisibilityState, SortingState } from "@tanstack/react-table"
import {
  IconArrowDown,
  IconArrowUp,
  IconArrowsSort,
  IconChevronDown,
  IconEyeOff,
  IconSearchOff,
} from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DetailPopover, NoValue } from "@/components/detail-popover"
import { spacers } from "@/components/record-list"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useIpInfo } from "@/hooks/use-ip-info"
import { usePagedRows } from "@/hooks/use-paged-rows"
import { ipInfo } from "@/lib/ip-lookup"
import type { IpInfo } from "@/lib/ip-lookup"
import { ipFields, ipValue } from "@/lib/ip-columns"
import {
  columnWidth,
  detailColumns,
  detailUnit,
  kindColumns,
  localTime,
  logKinds,
  statusVariant,
  textColumns,
} from "@/lib/entra-logs"
import type { LogKind, LogRow } from "@/lib/entra-logs"

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  columnVisibilityFeature,
})
const helper = createColumnHelper<typeof features, LogRow>()

/** The ProxyCheck columns as the table mounts them. The list they come off is
shared with the search, so a term reaches what a reader can see. */
const ipColumns = ipFields.map(([name, read]) =>
  helper.accessor((row) => ipValue(row, name), {
    id: name,
    header: ({ column }) => <SortHeader column={column} label={name} />,
    // These read off the lookup store rather than off the row, and a row keeps
    // whatever it read the first time it was asked, which for most of a run is
    // nothing. The sort reads the store itself, so a click sorts on what has
    // landed by the time it is clicked.
    sortFn: (a, b) =>
      ipValue(a.original, name).localeCompare(ipValue(b.original, name)),
    cell: ({ row }) => <IpCell ip={row.original["IP Address"]} read={read} />,
  })
)

const detailColumn = (name: (typeof detailColumns)[number]) =>
  helper.accessor(name, {
    header: ({ column }) => <SortHeader column={column} label={name} />,
    // A list of policies has no order of its own, so these sort by how long it
    // is: the records that went through the most of them first.
    sortFn: (a, b) => a.original[name].length - b.original[name].length,
    cell: ({ getValue }) => (
      <DetailPopover label={detailUnit(name)} details={getValue()} />
    ),
  })

/** The expandable column that spells out a plain one, kept beside it rather
than at the far end of the table. */
const spelledOut: Partial<
  Record<(typeof textColumns)[number], (typeof detailColumns)[number]>
> = {
  "Authentication Requirement": "Authentication Details",
  "Conditional Access": "Conditional Access Policies",
}

const columns = helper.columns([
  ...textColumns.flatMap((name) => {
    const detail = spelledOut[name]
    return [
      helper.accessor(name, {
        header: ({ column }) => <SortHeader column={column} label={name} />,
        // The row keeps the timestamp as it arrived, so it sorts and filters by
        // the instant. Only the cell speaks the reader's locale.
        cell: ({ getValue }) => {
          const value = getValue()
          if (value === "") return <NoValue />
          if (name === "Date") return localTime(value)
          // A failure is red here for the same reason it is red on the charts
          // and in the findings: it is the thing being looked for, and a
          // column of identical grey words hides it.
          if (name === "Status") {
            return <Badge variant={statusVariant(value)}>{value}</Badge>
          }
          return value
        },
        sortFn:
          name === "Date"
            ? (a, b) =>
                Date.parse(a.getValue(name)) - Date.parse(b.getValue(name))
            : "auto",
      }),
      // What ProxyCheck says about that address, read next to the address itself.
      ...(name === "IP Address" ? ipColumns : []),
      ...(detail === undefined ? [] : [detailColumn(detail)]),
    ]
  }),
  ...detailColumns
    .filter((name) => !Object.values(spelledOut).includes(name))
    .map(detailColumn),
])

/** Off until the Columns menu turns them on: identifiers nobody reads by eye,
the user agent that Browser and OS already say in words, and the coordinates the
map draws. */
const startsHidden: ColumnVisibilityState = Object.fromEntries(
  [
    "Record ID",
    "Correlation ID",
    "User ID",
    "Application ID",
    "Resource ID",
    "Device ID",
    "Target ID",
    "Session ID",
    "User-Agent",
    "Domain",
    "Coordinates",
  ].map((name) => [name, false])
)
// The tallest a row gets: the popover trigger in the two detail columns, plus
// the cell padding and the row border. Text-only rows need 4px less, but they
// are held at this height so a row keeps it whatever columns are mounted.
// Pinned rather than measured: measuring rows in a table is a loop, because
// resizing the spacer row re-lays out every other row, which fires the observer
// again. That loop pegged Firefox hard enough to stop it painting.
const rowHeight = 37

export type LogTableInstance = ReturnType<typeof useLogTable>

/** The table over the records, and the set of columns no loaded export fills
in. Held out here rather than inside the table because the Columns menu sits in
the toolbar, a long way from the rows it governs. */
export function useLogTable(data: Array<LogRow>, shownKinds: Array<LogKind>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] =
    useState<ColumnVisibilityState>(startsHidden)
  /** The columns only a switched-off export fills in. They are held hidden and
  kept out of the Columns menu, rather than shown there as a column that will
  not come back. A column two kinds fill in survives one of them going off: the
  Purview list overlaps both of the others, so this is a difference of the two
  sets rather than the union of the hidden one. */
  const suppressed = useMemo(() => {
    const shown = new Set(
      shownKinds.flatMap((kind) => kindColumns[kind] as ReadonlyArray<string>)
    )
    return new Set(
      logKinds
        .filter((kind) => !shownKinds.includes(kind))
        .flatMap((kind) => kindColumns[kind] as ReadonlyArray<string>)
        .filter((column) => !shown.has(column))
    )
  }, [shownKinds])
  const visibility = useMemo(
    () => ({
      ...columnVisibility,
      ...Object.fromEntries([...suppressed].map((name) => [name, false])),
    }),
    [columnVisibility, suppressed]
  )
  const table = useTable({
    features,
    columns,
    data,
    state: { sorting, columnVisibility: visibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
  })

  return { table, suppressed }
}

/** Which columns are mounted. Lives in the toolbar beside the search, because
it belongs to the same set of records every other view reads. */
export function ColumnsMenu({ table, suppressed }: LogTableInstance) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        Columns
        <IconChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-96 w-56 overflow-y-auto"
      >
        <DropdownMenuGroup>
          {table
            .getAllColumns()
            .filter(
              (column) => column.getCanHide() && !suppressed.has(column.id)
            )
            .map((column) => (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={column.getIsVisible()}
                onCheckedChange={(value) => column.toggleVisibility(value)}
              >
                {column.id}
              </DropdownMenuCheckboxItem>
            ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Every record the search left, one row each, virtualized down and across.
`hasRows` separates the two ways of being empty: a search that matched nothing,
and no records to search in the first place. */
export function LogTable({
  table,
  data,
  hasRows,
}: {
  table: LogTableInstance["table"]
  data: Array<LogRow>
  hasRows: boolean
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const sorted = table.getRowModel().rows
  // `data` rather than `sorted`: paging starts over for a new file or a new
  // query, and stays where it is when a column is sorted.
  const ready = usePagedRows(scroller, sorted.length, data)
  const virtualizer = useVirtualizer({
    count: ready,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    // Rows mounted past the fold. Every one of them is 23 cells of DOM, so this
    // stays small. A fast scroll runs out of them and stops at the end of the
    // pages that are there, until the next one lands a frame later.
    overscan: 20,
  })
  const visible = virtualizer.getVirtualItems()
  const [padTop, padBottom] = spacers(visible, virtualizer.getTotalSize())
  const shown = table.getVisibleLeafColumns()
  // Fixed layout only honours the per-column widths when the table itself is
  // exactly as wide as they add up to. Left to size itself it shares out the
  // slack and the columns drift.
  const tableWidth = shown.reduce(
    (total, column) => total + columnWidth(column.id),
    0
  )
  // Columns are virtualized the same way rows are: 23 of them times every
  // mounted row is most of the DOM on screen, and a screen only ever shows a
  // handful. Widths are known up front, so nothing here needs measuring.
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: shown.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => columnWidth(shown[index].id),
    overscan: 3,
  })
  const columnItems = columnVirtualizer.getVirtualItems()
  const [padLeft, padRight] = spacers(
    columnItems,
    columnVirtualizer.getTotalSize()
  )
  // Two more than the mounted columns covers the spacers. Browsers clamp a
  // colSpan that overshoots, so this never has to be exact.
  const spanAll = columnItems.length + 2

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Table
        containerRef={scroller}
        className="table-fixed"
        style={{ width: tableWidth }}
      >
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {padLeft > 0 ? <th style={{ width: padLeft }} /> : null}
              {columnItems.map((item) => {
                const header = group.headers[item.index]

                return (
                  <TableHead
                    key={header.id}
                    style={{ width: item.size }}
                    className="whitespace-nowrap"
                  >
                    <table.FlexRender header={header} />
                  </TableHead>
                )
              })}
              {padRight > 0 ? <th style={{ width: padRight }} /> : null}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {padTop > 0 ? (
            <tr>
              <td colSpan={spanAll} style={{ height: padTop }} />
            </tr>
          ) : null}
          {visible.map((item) => {
            const row = sorted[item.index]
            const cells = row.getVisibleCells()

            return (
              <TableRow
                key={row.id}
                data-index={item.index}
                style={{ height: rowHeight }}
                // Striping off the data index, not the DOM position: the
                // mounted set slides as you scroll, so `even:` would make
                // the bands crawl.
                className={item.index % 2 === 1 ? "bg-muted/40" : undefined}
              >
                {padLeft > 0 ? <td /> : null}
                {columnItems.map((column) => {
                  const cell = cells[column.index]

                  return (
                    <ScrollCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </ScrollCell>
                  )
                })}
                {padRight > 0 ? <td /> : null}
              </TableRow>
            )
          })}
          {padBottom > 0 ? (
            <tr>
              <td colSpan={spanAll} style={{ height: padBottom }} />
            </tr>
          ) : null}
        </TableBody>
      </Table>
      {sorted.length === 0 ? (
        // Over the table, not in it: a cell would centre itself across the
        // full table width, which is several screens wide.
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon" className="bg-input">
                {hasRows ? <IconSearchOff /> : <IconEyeOff />}
              </EmptyMedia>
              <EmptyTitle>
                {hasRows ? "No match" : "Nothing to show"}
              </EmptyTitle>
              {/* The search case says it in the title. Only the hidden
              case has anything left to explain. */}
              {hasRows ? null : (
                <EmptyDescription>
                  Every loaded file is hidden, empty, or of an export that is
                  switched off.
                </EmptyDescription>
              )}
            </EmptyHeader>
          </Empty>
        </div>
      ) : null}
    </div>
  )
}

/** One enriched value. Reads the lookup store directly, so a result repaints
the few mounted cells for that address and nothing else. */
function IpCell({ ip, read }: { ip: string; read: (info: IpInfo) => string }) {
  useIpInfo()
  if (ip === "") return <NoValue />
  const info = ipInfo(ip)
  // A screenful is hundreds of these cells waiting on the same run, and a
  // spinner in each of them is a screenful of separate things turning. A bar
  // the shape of the value that is coming reads as one table filling in.
  if (info === undefined) return <Skeleton className="h-3 w-16" />
  return info.error !== undefined ? (
    <span className="text-destructive" title={info.error}>
      failed
    </span>
  ) : (
    read(info) || <NoValue />
  )
}

function SortHeader({
  column,
  label,
}: {
  column: {
    getIsSorted: () => false | "asc" | "desc"
    toggleSorting: () => void
  }
  label: string
}) {
  const sorted = column.getIsSorted()

  return (
    <Button
      variant="ghost"
      size="sm"
      className="-mx-2"
      onClick={() => column.toggleSorting()}
    >
      {label}
      {sorted === "asc" ? (
        <IconArrowUp data-icon="inline-end" />
      ) : sorted === "desc" ? (
        <IconArrowDown data-icon="inline-end" />
      ) : (
        <IconArrowsSort data-icon="inline-end" className="opacity-40" />
      )}
    </Button>
  )
}

// No edge fade in here. A screenful is 23 columns by 78 rows, and giving each of
// those 1794 cells its own ResizeObserver, its own measuring effect and its own
// mask left Firefox with no main thread to paint with. The fade on the table
// container is one element and stays.
function ScrollCell({ children }: { children: ReactNode }) {
  return (
    <TableCell className="p-0">
      <div className="[scrollbar-width:none] overflow-x-auto p-2 whitespace-nowrap [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </TableCell>
  )
}
