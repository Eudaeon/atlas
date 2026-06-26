import { useCallback, useMemo, useRef, useState } from "react"
import {
  type ColumnDef,
  type FilterFn,
  type Row,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleHelp,
} from "lucide-react"

import { compileQuery } from "@/lib/table-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  pageSize?: number
  searchPlaceholder?: string
  initialColumnVisibility?: VisibilityState
  // Override the searchable string for specific columns (keyed by column label),
  // e.g. supplying an ISO date so range/comparison queries sort chronologically
  // rather than by the displayed, localised text.
  searchValueOverrides?: (row: TData) => Record<string, string>
}

export function DataTable<TData, TValue>({
  columns,
  data,
  pageSize = 12,
  searchPlaceholder = "Search...",
  initialColumnVisibility = {},
  searchValueOverrides,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState("")
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    initialColumnVisibility
  )

  // The column labels (their ids) drive field resolution in the query language.
  const labels = useMemo(
    () => columns.map((c) => c.id).filter((id): id is string => Boolean(id)),
    [columns]
  )
  // Compile the search box once per keystroke, not once per row. The matcher and
  // labels are read through refs so the table's globalFilterFn stays stable.
  const matcher = useMemo(
    () => compileQuery(globalFilter, labels),
    [globalFilter, labels]
  )
  const matcherRef = useRef(matcher)
  matcherRef.current = matcher
  const labelsRef = useRef(labels)
  labelsRef.current = labels
  const overridesRef = useRef(searchValueOverrides)
  overridesRef.current = searchValueOverrides

  // Evaluate the whole row against the compiled query. The result is independent
  // of which column TanStack passes, so its per-column OR collapses to this
  // verdict.
  const globalFilterFn = useCallback<FilterFn<TData>>((row: Row<TData>) => {
    const values: Record<string, string> = {}
    for (const label of labelsRef.current) {
      values[label] = String(row.getValue(label) ?? "")
    }
    Object.assign(values, overridesRef.current?.(row.original) ?? {})
    return matcherRef.current(values)
  }, [])

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    globalFilterFn,
    initialState: { pagination: { pageSize } },
    state: { sorting, globalFilter, columnVisibility },
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Input
            placeholder={searchPlaceholder}
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            className="pr-9"
          />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Search syntax help"
                    className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground/60 transition-colors hover:text-foreground"
                  />
                }
              >
                <CircleHelp className="size-4" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs py-2.5">
                <div className="flex flex-col items-start gap-1.5">
                  <span className="font-medium">Search syntax</span>
                  <span>
                    Type words to match any column, or scope a term to one:
                  </span>
                  <ul className="flex flex-col gap-1">
                    <li className="flex flex-wrap items-baseline gap-x-2">
                      <code className="font-mono">country:France</code>
                      <span className="text-background/70">one field</span>
                    </li>
                    <li className="flex flex-wrap items-baseline gap-x-2">
                      <code className="font-mono">{`"United States"`}</code>
                      <span className="text-background/70">exact phrase</span>
                    </li>
                    <li className="flex flex-wrap items-baseline gap-x-2">
                      <code className="font-mono">
                        status:(Success OR Failure)
                      </code>
                      <span className="text-background/70">any of</span>
                    </li>
                    <li className="flex flex-wrap items-baseline gap-x-2">
                      <code className="font-mono">-status:Failure</code>
                      <span className="text-background/70">exclude</span>
                    </li>
                    <li className="flex flex-wrap items-baseline gap-x-2">
                      <code className="font-mono">score:&gt;=3</code>
                      <span className="text-background/70">
                        compare numbers
                      </span>
                    </li>
                    <li className="flex flex-wrap items-baseline gap-x-2">
                      <code className="font-mono">score:[3 TO 5]</code>
                      <span className="text-background/70">range</span>
                    </li>
                    <li className="flex flex-wrap items-baseline gap-x-2">
                      <code className="font-mono">ip:77.88*</code>
                      <span className="text-background/70">wildcard</span>
                    </li>
                  </ul>
                  <span className="text-background/70">
                    Lucene syntax: combine with AND, OR, NOT and ( ). Fields:
                    ip, country, status, os, reputation, score, and more.
                  </span>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" className="ml-auto" />}
          >
            Columns
            <ChevronDown />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) => column.toggleVisibility(!!value)}
                >
                  {column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="overflow-hidden rounded-2xl border">
        {/* Fixed layout + explicit column widths: sorting reorders rows but
            never resizes columns to fit the new page's content. */}
        <Table
          className="table-fixed"
          style={{ minWidth: table.getTotalSize() }}
        >
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="bg-muted">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    style={{ width: header.getSize() }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="odd:bg-background even:bg-muted/40"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className="p-0"
                      style={{ width: cell.column.getSize() }}
                    >
                      {/* Overflowing values scroll horizontally within the cell
                          rather than truncating. The scroll container must be a
                          block-level element (a table-cell isn't reliably
                          user-scrollable), and its scrollbar is hidden (via the
                          shared scrollbar-hide utility) so the overflow is
                          revealed by dragging/wheeling, not a track. */}
                      <div className="scrollbar-hide overflow-x-auto p-2 pl-3 whitespace-nowrap">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </div>
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="First page"
          onClick={() => table.setPageIndex(0)}
          disabled={!table.getCanPreviousPage()}
        >
          <ChevronsLeft />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous page"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          <ChevronLeft />
        </Button>
        <span className="px-2 text-sm text-muted-foreground">
          Page {table.getState().pagination.pageIndex + 1} of{" "}
          {table.getPageCount() || 1}
        </span>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next page"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          <ChevronRight />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Last page"
          onClick={() => table.setPageIndex(table.getPageCount() - 1)}
          disabled={!table.getCanNextPage()}
        >
          <ChevronsRight />
        </Button>
      </div>
    </div>
  )
}
