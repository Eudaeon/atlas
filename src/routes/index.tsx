import {
  Suspense,
  lazy,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from "react"
import { createFileRoute } from "@tanstack/react-router"
import { IconFileUpload } from "@tabler/icons-react"

import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Analysis } from "@/components/analysis"
import { ColumnsMenu, LogTable, useLogTable } from "@/components/log-table"
import { Sessions } from "@/components/sessions"
import { Statistics } from "@/components/statistics"
import { Toolbar, views } from "@/components/toolbar"
import type { View } from "@/components/toolbar"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { toast } from "@/components/ui/toast"
import { showEnrichment } from "@/components/enrichment-toast"
import { useKeys } from "@/hooks/use-keys"
import { loadFiles, visibleRows } from "@/lib/load-files"
import type { LoadedFile } from "@/lib/load-files"
import { hasProxycheckKey, lookupIps } from "@/lib/ip-lookup"
import { many } from "@/lib/analysis"
import { compileQuery } from "@/lib/lucene-filter"
import { logKinds } from "@/lib/entra-logs"
import type { LogKind } from "@/lib/entra-logs"

// maplibre is most of a megabyte and only the map view draws with it, so it
// loads when that view is first opened. Everyone who loads a file and stays in
// the table was paying for it.
const ConnectionMap = lazy(() =>
  import("@/components/connection-map").then((module) => ({
    default: module.ConnectionMap,
  }))
)

export const Route = createFileRoute("/")({ component: App })

/** What the log-type toggles are called. */
const kindLabel: Record<LogKind, string> = {
  "sign-in": "Sign-ins",
  audit: "Audit",
  purview: "Purview",
}

function App() {
  const [files, setFiles] = useState<Array<LoadedFile>>([])
  const [askKey, setAskKey] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [view, setView] = useState<View>("table")
  const [query, setQuery] = useState("")
  const [kinds, setKinds] = useState<Array<LogKind>>(logKinds)
  const input = useRef<HTMLInputElement>(null)
  const searchBox = useRef<HTMLInputElement>(null)
  // The eye on a finding or a session: the same records, on the map, reached by
  // putting what the row is about in the search box. Nothing hidden happens, so
  // the query can be read and widened.
  const showOnMap = (wanted: string) => {
    setQuery(wanted)
    setView("map")
  }
  const rows = useMemo(() => visibleRows(files, kinds), [files, kinds])
  // Which of the exports are on the table right now. A kind nobody loaded,
  // or whose file is hidden, has nothing to show and no toggle to press.
  const loadedKinds = useMemo(
    () =>
      new Set(
        files.filter((file) => !file.hidden).flatMap((file) => file.kinds)
      ),
    [files]
  )
  const shownKinds = useMemo(
    () =>
      logKinds.filter((kind) => loadedKinds.has(kind) && kinds.includes(kind)),
    [loadedKinds, kinds]
  )
  const search = useDeferredValue(query)
  const { data, queryError } = useMemo(() => {
    try {
      return { data: rows.filter(compileQuery(search)), queryError: "" }
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      return { data: rows, queryError: reason }
    }
  }, [rows, search])
  const { table, suppressed } = useLogTable(data, shownKinds)

  async function onFiles(picked: FileList | null) {
    const chosen = [...(picked ?? [])]
    if (input.current) input.current.value = ""
    if (chosen.length === 0) return
    // Reading a big export is seconds of work. The toast goes up before any of
    // it starts, and the parser hands the thread back often enough to repaint.
    const progress = toast.add({
      type: "loading",
      title: chosen[0].name,
      description: "Reading",
      timeout: 0,
    })
    // Two frames for that toast to reach the screen: reading the file blocks
    // the thread for about a second on a 350MB export, and nothing paints once
    // that starts. The spinner keeps turning through it, on the compositor.
    await new Promise((painted) =>
      requestAnimationFrame(() => requestAnimationFrame(painted))
    )
    const { loaded, failures } = await loadFiles(chosen, (name, done) =>
      toast.update(progress, {
        title: name,
        description: `${Math.round(done * 100)}%`,
      })
    )
    toast.close(progress)
    setFiles((current) => [...current, ...loaded])
    if (failures.length > 0) {
      toast.add({
        type: "error",
        title:
          failures.length === 1
            ? "A file could not be read"
            : `${failures.length} files could not be read`,
        description: failures.join("\n"),
        timeout: 0,
      })
    }
    if (loaded.length > 0) {
      const records = loaded.reduce(
        (total, file) => total + file.rows.length,
        0
      )
      toast.add({
        type: "success",
        title:
          loaded.length === 1
            ? loaded[0].name
            : `${loaded.length} files loaded`,
        description: many(records, "record"),
      })
      // Not awaited: the lookups go out a hundred addresses at a time and run
      // for as long as they take, with the table already usable.
      const ips = new Set(
        loaded.flatMap((file) => file.rows.map((row) => row["IP Address"]))
      )
      const asking = lookupIps(ips, showEnrichment)
      // The queue waits for a key rather than failing, so ask for one. A file
      // that came in already enriched queues nothing and needs no key.
      if (asking > 0 && !hasProxycheckKey()) setAskKey(true)
    }
  }

  // `/` and ctrl-K put the caret in the search box, which is where this app is
  // used from, and alt with a number switches view. Everything but ctrl-K waits
  // until nothing is being typed into, the way the map's own 1/2/3 panel keys
  // do.
  useKeys((event, typing) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault()
      searchBox.current?.focus()
      searchBox.current?.select()
      return
    }
    if (typing || event.metaKey || event.ctrlKey) return
    if (event.key === "/") {
      event.preventDefault()
      searchBox.current?.focus()
      return
    }
    // Read off the physical key: alt and a digit is a punctuation mark on
    // half the keyboard layouts in use. The map answers the bare digits, so
    // the views take them with alt held.
    if (!event.altKey || !/^Digit[1-9]$/.test(event.code)) return
    const at = Number(event.code.slice(5))
    if (at > views.length) return
    event.preventDefault()
    setView(views[at - 1][0])
  })

  /** A drag only counts if it is carrying files: dragging a selection about
  the page must not put the drop sheet up. */
  const carriesFiles = (transfer: DataTransfer) =>
    transfer.types.includes("Files")

  return (
    <div
      className="flex h-svh flex-col overflow-hidden"
      onDragOver={(event) => {
        if (!carriesFiles(event.dataTransfer)) return
        // Without this the browser navigates to the file rather than
        // handing it over.
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        // Crossing into a child fires a leave on the parent. Only a drag that
        // has actually left the window takes the sheet down.
        if (event.currentTarget.contains(event.relatedTarget as Node | null))
          return
        setDragging(false)
      }}
      onDrop={(event) => {
        if (!carriesFiles(event.dataTransfer)) return
        event.preventDefault()
        setDragging(false)
        onFiles(event.dataTransfer.files)
      }}
    >
      <input
        ref={input}
        type="file"
        multiple
        accept="application/json,.json,text/csv,.csv"
        className="sr-only"
        onChange={(event) => onFiles(event.target.files)}
      />

      <Toolbar
        files={files}
        setFiles={setFiles}
        onAdd={() => input.current?.click()}
        view={view}
        setView={setView}
        query={query}
        setQuery={setQuery}
        invalid={queryError !== ""}
        search={searchBox}
        matched={data.length}
        rows={rows}
        askKey={askKey}
        setAskKey={setAskKey}
        tools={
          <>
            {/* Every view reads the same records, so the export switch stands
            beside the search rather than with the table's own tools. */}
            <ToggleGroup
              multiple
              value={shownKinds}
              onValueChange={(value) => setKinds(value as Array<LogKind>)}
              variant="outline"
              aria-label="Log types"
            >
              {logKinds.map((kind) => (
                <ToggleGroupItem
                  key={kind}
                  value={kind}
                  disabled={!loadedKinds.has(kind)}
                >
                  {kindLabel[kind]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {view !== "table" ? null : (
              <ColumnsMenu table={table} suppressed={suppressed} />
            )}
          </>
        }
      />

      {queryError ? (
        <Alert
          variant="destructive"
          className="shrink-0 rounded-none border-x-0 border-t-0"
        >
          <AlertTitle>{queryError}</AlertTitle>
        </Alert>
      ) : null}
      {files.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <Empty className="w-auto flex-none rounded-xl border border-dashed bg-muted p-12">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="bg-input">
                <IconFileUpload />
              </EmptyMedia>
              <EmptyTitle>No file loaded</EmptyTitle>
              <EmptyDescription>
                Drop Entra sign-in or audit exports here, or a Purview audit
                search.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => input.current?.click()}>
                <IconFileUpload data-icon="inline-start" />
                Choose files
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col gap-3 p-6">
          {view === "map" ? (
            <Suspense
              fallback={
                // Most of a megabyte of maplibre, over a connection that may be
                // slow: a block where the map is about to be says more about
                // the wait than a spinner in the middle of an empty page.
                <Skeleton className="flex-1 rounded-xl" />
              }
            >
              <ConnectionMap rows={data} />
            </Suspense>
          ) : null}
          {view === "sessions" ? (
            <Sessions rows={data} onShow={showOnMap} />
          ) : null}
          {view === "statistics" ? <Statistics rows={data} /> : null}
          {view === "analysis" ? (
            <Analysis rows={data} onShow={showOnMap} />
          ) : null}
          {view === "table" ? (
            <LogTable table={table} data={data} hasRows={rows.length > 0} />
          ) : null}
        </main>
      )}

      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6 supports-backdrop-filter:backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary/40 px-12 py-10">
            <IconFileUpload className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">Drop to load</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
