import { useRef, useState } from "react"
import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react"
import {
  IconAlertTriangle,
  IconChartBar,
  IconHistory,
  IconLink,
  IconMap,
  IconSearch,
  IconTable,
  IconX,
} from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { FileManager } from "@/components/file-manager"
import { ProxycheckKey } from "@/components/proxycheck-key"
import { SearchHelp } from "@/components/search-help"
import { ThemeToggle } from "@/components/theme-toggle"
import { many } from "@/lib/analysis"
import {
  forgetSearches,
  rememberSearch,
  searchHistory,
} from "@/lib/search-history"
import type { LoadedFile } from "@/lib/load-files"
import type { LogRow } from "@/lib/entra-logs"

/** The ways to read the same filtered records. */
export const views = [
  ["table", "Table", IconTable],
  ["map", "Map", IconMap],
  ["sessions", "Sessions", IconLink],
  ["statistics", "Statistics", IconChartBar],
  ["analysis", "Analysis", IconAlertTriangle],
] as const

export type View = (typeof views)[number][0]

/** The search box, and under it the searches run before this one. A query is
worth keeping and a nuisance to retype: they are long, they are exact, and the
one you want next is usually the one you ran two views ago. Only what was
pressed Enter on is remembered, so half-typed queries stay out of the list. */
function SearchBox({
  query,
  setQuery,
  invalid,
  search,
}: {
  query: string
  setQuery: (query: string) => void
  invalid: boolean
  search: RefObject<HTMLInputElement | null>
}) {
  const [history, setHistory] = useState(searchHistory)
  const [open, setOpen] = useState(false)
  const list = useRef<HTMLDivElement>(null)

  return (
    <div
      className="relative min-w-48 flex-1 sm:max-w-xs"
      // The caret and the list are the two places the list is wanted from, and
      // nowhere else is: the help and the clear button sit in the same box, and
      // opening one of those over the list is two panels at once. React blur
      // bubbles, so this catches leaving the box as well as crossing it.
      onBlur={(event) => {
        const to = event.relatedTarget
        if (to !== search.current && !list.current?.contains(to)) setOpen(false)
      }}
    >
      <InputGroup>
        <InputGroupAddon>
          <IconSearch />
        </InputGroupAddon>
        <InputGroupInput
          ref={search}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false)
              setQuery("")
            }
            // A query that does not parse filters nothing, so it is not a
            // search anyone will want back.
            if (event.key === "Enter" && !invalid) {
              setHistory(rememberSearch(query))
              setOpen(false)
            }
          }}
          aria-invalid={invalid}
          aria-label="Search"
          placeholder="Search records"
        />
        <InputGroupAddon align="inline-end">
          {query === "" ? null : (
            <InputGroupButton
              size="icon-xs"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              <IconX />
            </InputGroupButton>
          )}
          <SearchHelp />
        </InputGroupAddon>
      </InputGroup>

      {open && history.length > 0 ? (
        // Clicking inside the list must not take the caret out of the box, or
        // the list would be gone before the click landed.
        <div
          ref={list}
          onMouseDown={(event) => event.preventDefault()}
          className="absolute top-full right-0 left-0 z-50 mt-1 flex flex-col rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <IconHistory className="size-3.5" />
              Recent searches
            </span>
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => setHistory(forgetSearches())}
            >
              Clear
            </Button>
          </div>
          {history.map((past) => (
            <button
              key={past}
              type="button"
              className="truncate rounded-md px-2 py-1.5 text-left font-mono text-xs hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              onClick={() => {
                setQuery(past)
                setOpen(false)
                search.current?.focus()
              }}
            >
              {past}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** The bar every view is reached from and searched through. It is chrome
rather than a floating panel: the map runs full-bleed underneath it, which is
why it sits above the map's own layers rather than in the page's flow. */
export function Toolbar({
  files,
  setFiles,
  onAdd,
  view,
  setView,
  query,
  setQuery,
  invalid,
  search,
  matched,
  rows,
  askKey,
  setAskKey,
  tools,
}: {
  files: Array<LoadedFile>
  setFiles: Dispatch<SetStateAction<Array<LoadedFile>>>
  onAdd: () => void
  view: View
  setView: (view: View) => void
  query: string
  setQuery: (query: string) => void
  invalid: boolean
  search: RefObject<HTMLInputElement | null>
  matched: number
  rows: Array<LogRow>
  askKey: boolean
  setAskKey: (open: boolean) => void
  tools?: ReactNode
}) {
  const loaded = files.length > 0
  return (
    <header
      data-over-map
      className="sticky top-0 z-40 flex shrink-0 flex-col border-b bg-background/85 supports-backdrop-filter:backdrop-blur-md"
    >
      {/* Wraps rather than pushing its right-hand end off a narrow window. */}
      <div className="flex min-h-12 flex-wrap items-center gap-2 px-3 py-1.5">
        <span className="flex shrink-0 items-center gap-2 pr-1">
          {/* The app's own icon, not a glyph: the word beside it already says
          what it is, so it carries no alt text of its own. */}
          <img src="/logo192.png" alt="" className="size-5" />
          <span className="text-sm font-semibold tracking-tight">Atlas</span>
        </span>

        {loaded ? (
          <>
            <Separator orientation="vertical" className="mx-1" />
            <FileManager
              files={files}
              setFiles={setFiles}
              onAdd={onAdd}
              rows={rows}
            />
            <Separator orientation="vertical" className="mx-1" />
            <ToggleGroup
              spacing={0}
              value={[view]}
              aria-label="View"
              // Clicking the view you are already on gives an empty value
              // back. Nothing to switch to, so nothing happens.
              onValueChange={(value) => {
                if (value.length > 0) setView(value[0] as View)
              }}
            >
              {views.map(([name, label, Icon]) => (
                <Tooltip key={name}>
                  <TooltipTrigger
                    render={
                      <ToggleGroupItem value={name} aria-label={label}>
                        <Icon data-icon="inline-start" />
                        {/* Narrow windows keep the icons and drop the words,
                        which the tooltip and the label still carry. */}
                        <span className="sr-only lg:not-sr-only">{label}</span>
                      </ToggleGroupItem>
                    }
                  />
                  <TooltipContent className="lg:hidden">{label}</TooltipContent>
                </Tooltip>
              ))}
            </ToggleGroup>
          </>
        ) : null}

        <span className="ml-auto flex shrink-0 items-center gap-1">
          <ProxycheckKey open={askKey} setOpen={setAskKey} />
          <ThemeToggle />
        </span>
      </div>

      {loaded ? (
        <div className="flex min-h-11 flex-wrap items-center gap-2 border-t px-3 py-1.5">
          <SearchBox
            query={query}
            setQuery={setQuery}
            invalid={invalid}
            search={search}
          />
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {matched === rows.length
              ? many(rows.length, "record")
              : `${matched.toLocaleString()} of ${rows.length.toLocaleString()}`}
          </Badge>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {tools}
          </div>
        </div>
      ) : null}
    </header>
  )
}
