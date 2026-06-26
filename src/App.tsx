import { Suspense, lazy, useCallback, useMemo, useRef, useState } from "react"

import { cn } from "@/lib/utils"
import { getApiKeys } from "@/lib/proxycheck"
import { getCrowdSecKeys } from "@/lib/crowdsec"
import { userLabel, type SignIn } from "@/lib/signin"
import { buildPalette } from "@/lib/facets"
import { canShare, desktop } from "@/lib/desktop"
import { useTheme } from "@/providers/theme-provider"
import { useSignIns } from "@/hooks/use-sign-ins"
import { useShareLink } from "@/hooks/use-share-link"
import { useFileDrop } from "@/hooks/use-file-drop"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { ApiKeyDialog } from "@/features/enrichment/api-key-dialog"
import { ThemeToggle } from "@/features/app-shell/theme-toggle"
import { StatusDialog } from "@/features/app-shell/status-dialog"
import { DragOverlay } from "@/features/app-shell/drag-overlay"
import { UploadEmptyState } from "@/features/app-shell/empty-state"
import { Toolbar } from "@/features/app-shell/toolbar"
import { VIEWS, type View } from "@/features/app-shell/views"
import { ViewFallback } from "@/features/app-shell/view-fallback"

// The four views are split into their own chunks and loaded on demand: the map
// pulls in MapLibre and the analysis/statistics views pull in Recharts, none of
// which belong in the initial bundle the empty landing state needs.
const TableView = lazy(() =>
  import("@/features/table/table-view").then((m) => ({ default: m.TableView }))
)
const StatisticsView = lazy(() =>
  import("@/features/statistics/statistics-view").then((m) => ({
    default: m.StatisticsView,
  }))
)
const MapView = lazy(() =>
  import("@/features/map/map-view").then((m) => ({ default: m.MapView }))
)
const AnalysisView = lazy(() =>
  import("@/features/analysis/analysis-view").then((m) => ({
    default: m.AnalysisView,
  }))
)

export function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [apiKeys, setApiKeys] = useState(() => getApiKeys())
  const [crowdsecKeys, setCrowdsecKeys] = useState(() => getCrowdSecKeys())
  const [view, setView] = useState<View>("table")
  // Lifted so surfaces other than the dialog's own trigger can open it — the
  // map's no-locations empty state points the user here to add a ProxyCheck key.
  const [keysOpen, setKeysOpen] = useState(false)
  // When set, the map shows only this subset — the connections behind a finding
  // the user chose to inspect from the Analysis view. Cleared on any manual view
  // switch or a new upload.
  const [mapFocus, setMapFocus] = useState<SignIn[] | null>(null)
  const { toggleTheme } = useTheme()

  const {
    rows,
    enrichment,
    crowdsec,
    parsing,
    error,
    loadFile,
    applyShared,
    reEnrich,
    dismissError,
  } = useSignIns(apiKeys, crowdsecKeys)

  // Clear any map focus when a fresh dataset arrives so the map opens on it whole.
  const handleShared = useCallback(
    (payload: Parameters<typeof applyShared>[0]) => {
      setMapFocus(null)
      applyShared(payload)
    },
    [applyShared]
  )
  const { share, openShare } = useShareLink(handleShared)

  // A single user→colour palette built from the whole dataset, shared by the
  // Analysis view and the map so a user's dot is the same colour in both — and
  // stays stable even when the map is focused on a finding's subset.
  const colorFor = useMemo(
    () => buildPalette(Array.from(new Set((rows ?? []).map(userLabel)))),
    [rows]
  )

  const openFilePicker = useCallback(() => inputRef.current?.click(), [])

  // A fresh dataset replaces whatever is loaded, so drop any map focus first —
  // shared by the file picker and drag-and-drop.
  const loadDataset = useCallback(
    (file: File) => {
      setMapFocus(null)
      loadFile(file)
    },
    [loadFile]
  )

  const dragging = useFileDrop(loadDataset)

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (file) loadDataset(file)
  }

  function handleApiKeysChange(keys: string[]) {
    setApiKeys(keys)
    reEnrich(keys, crowdsecKeys)
  }

  function handleCrowdsecKeysChange(keys: string[]) {
    setCrowdsecKeys(keys)
    reEnrich(apiKeys, keys)
  }

  // Switch views from the toggle/keyboard, dropping any map focus so the map
  // reverts to the full dataset.
  const changeView = useCallback((next: View) => {
    setMapFocus(null)
    setView(next)
  }, [])

  // Focus the map on a finding's connections, then jump to it.
  const handleViewOnMap = useCallback((focus: SignIn[]) => {
    setMapFocus(focus)
    setView("map")
  }, [])

  const handleShare = useCallback(
    () => share(rows ?? [], enrichment, crowdsec),
    [share, rows, enrichment, crowdsec]
  )

  useKeyboardShortcuts(
    useMemo(
      () => ({
        u: openFilePicker,
        t: toggleTheme,
        s: rows && canShare ? handleShare : undefined,
        v: rows
          ? () => changeView(VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length])
          : undefined,
      }),
      [openFilePicker, toggleTheme, rows, handleShare, changeView, view]
    )
  )

  return (
    <div
      className={cn(
        "flex min-h-svh flex-col items-center p-6",
        // With data loaded the fixed top toolbar is shown; top-align the content
        // (with clearance) so a tall view's heading isn't hidden behind it. The
        // empty state has no toolbar, so keep it centred.
        rows ? "justify-start pt-28" : "justify-center"
      )}
    >
      {dragging ? <DragOverlay /> : null}

      <ApiKeyDialog
        apiKeys={apiKeys}
        onApiKeysChange={handleApiKeysChange}
        crowdsecKeys={crowdsecKeys}
        onCrowdsecKeysChange={handleCrowdsecKeysChange}
        open={keysOpen}
        onOpenChange={setKeysOpen}
      />
      <ThemeToggle />

      <StatusDialog
        parsing={parsing}
        error={error}
        onDismissError={dismissError}
      />

      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json,text/csv,.csv"
        className="hidden"
        onChange={handleFile}
      />

      {rows ? (
        <>
          <Toolbar
            view={view}
            onViewChange={changeView}
            onUpload={openFilePicker}
            onShare={handleShare}
            canShare={canShare}
          />
          <Suspense fallback={<ViewFallback view={view} />}>
            {view === "table" ? (
              <TableView
                rows={rows}
                enrichment={enrichment}
                crowdsec={crowdsec}
              />
            ) : view === "map" ? (
              <MapView
                rows={mapFocus ?? rows}
                enrichment={enrichment}
                crowdsec={crowdsec}
                colorFor={colorFor}
                focusActive={mapFocus !== null}
                onClearFocus={() => setMapFocus(null)}
                onConfigureKeys={() => setKeysOpen(true)}
              />
            ) : view === "analysis" ? (
              <AnalysisView
                rows={rows}
                enrichment={enrichment}
                crowdsec={crowdsec}
                colorFor={colorFor}
                onViewOnMap={handleViewOnMap}
              />
            ) : (
              <StatisticsView
                rows={rows}
                enrichment={enrichment}
                crowdsec={crowdsec}
              />
            )}
          </Suspense>
        </>
      ) : (
        <UploadEmptyState
          onUpload={openFilePicker}
          // Desktop only: the web app opens a share link just by visiting its
          // URL, and opening a `?id=` link needs a backend to resolve against.
          openShare={desktop?.isDesktop && canShare ? openShare : undefined}
        />
      )}
    </div>
  )
}

export default App
