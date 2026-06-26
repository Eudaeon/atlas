import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { TriangleAlert } from "lucide-react"

import { cn } from "@/lib/utils"
import { type SignIn, userLabel } from "@/lib/signin"
import type { EnrichmentMap } from "@/lib/proxycheck"
import type { CrowdSecMap } from "@/lib/crowdsec"
import { quantity, timestamp } from "@/lib/format"
import {
  type FacetValue,
  type LocationGroup,
  buildFacets,
  buildGroups,
  buildUsers,
  computeEffectiveDeselected,
  countWithoutLocation,
  hasAnyLocation,
  passingRows,
  prepareRows,
} from "@/lib/facets"
import {
  abbreviate,
  buildFeatures,
  markerRadius,
  pieElement,
  pointElement,
} from "@/lib/markers"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useTheme } from "@/providers/theme-provider"
import { MapEmptyState } from "@/features/map/empty-state"
import { UsersPanel } from "@/features/map/users-panel"
import { CategoriesPanel } from "@/features/map/categories-panel"
import { Timeline } from "@/features/map/timeline"
import { DetailsPanel } from "@/features/map/details-panel"
import { Button } from "@/components/ui/button"

type Mode = "light" | "dark"

const BASEMAP_SOURCE = "basemap"
const SOURCE_ID = "connections"
// A zero-size circle layer so the clustered source loads tiles (which makes
// querySourceFeatures return clusters); the visible markers are DOM elements.
const HIT_LAYER = "connections-hit"

// No-token raster basemap tiles from CARTO, one set per colour scheme. Only the
// tiles differ between light and dark, so a theme swap updates them in place
// (see setTiles below) rather than rebuilding the whole style.
function basemapTiles(mode: Mode): string[] {
  const variant = mode === "dark" ? "dark_all" : "light_all"
  return ["a", "b", "c", "d"].map(
    (s) => `https://${s}.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}.png`
  )
}

function mapStyle(mode: Mode): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      [BASEMAP_SOURCE]: {
        type: "raster",
        tiles: basemapTiles(mode),
        tileSize: 256,
        attribution: "© OpenStreetMap contributors © CARTO",
      },
    },
    layers: [{ id: BASEMAP_SOURCE, type: "raster", source: BASEMAP_SOURCE }],
  }
}

type MapViewProps = {
  rows: SignIn[]
  enrichment: EnrichmentMap
  crowdsec: CrowdSecMap
  // User→colour palette, built once from the full dataset so colours stay stable
  // whether the map shows everything or a focused subset.
  colorFor: (user: string) => string
  // Whether `rows` is a finding-focused subset rather than the whole dataset.
  focusActive?: boolean
  // Clear the focus and return the map to the full dataset.
  onClearFocus?: () => void
  // Open the enrichment key dialog; offered by the no-locations empty state.
  onConfigureKeys?: () => void
}

export function MapView({
  rows,
  enrichment,
  crowdsec,
  colorFor,
  focusActive = false,
  onClearFocus,
  onConfigureKeys,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)
  // Keys of the locations whose popovers are open. Several can be kept open at
  // once; clicking a point toggles its popover and clicking the map clears all.
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  // Stable so the memoised DetailsPanel isn't re-rendered as the map pans.
  const handleCloseDetails = useCallback(
    (key: string) => setSelectedKeys((keys) => keys.filter((k) => k !== key)),
    []
  )
  // Whether each side panel is expanded; its languette toggles it.
  const [usersOpen, setUsersOpen] = useState(true)
  const [categoriesOpen, setCategoriesOpen] = useState(true)
  const [timelineOpen, setTimelineOpen] = useState(true)

  // Number keys toggle the side panels (1 users, 2 categories, 3 timeline),
  // matching the shortcut hints on each languette. Only mounted with the map
  // view, so these are inactive elsewhere.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, textarea, select, [contenteditable='true']"))
      ) {
        return
      }
      if (event.key === "1") {
        event.preventDefault()
        setUsersOpen((open) => !open)
      } else if (event.key === "2") {
        event.preventDefault()
        setCategoriesOpen((open) => !open)
      } else if (event.key === "3") {
        event.preventDefault()
        setTimelineOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])
  // Screen position of each open popover, keyed by location key.
  const [anchors, setAnchors] = useState<
    Record<string, { x: number; y: number }>
  >({})
  const fittedRef = useRef(false)
  // Latest groups/colours read by the long-lived render handler without
  // recreating it, plus the DOM markers currently on screen (keyed by id).
  const groupsByKeyRef = useRef<Map<string, LocationGroup>>(new Map())
  const colorForRef = useRef<(user: string) => string>(() => "hsl(0 0% 60%)")
  const markersRef = useRef<Record<string, maplibregl.Marker>>({})

  // Rows ordered in time; the timeline indexes into this list and the slider
  // steps one connection at a time.
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => timestamp(a) - timestamp(b)),
    [rows]
  )
  const maxIndex = Math.max(sortedRows.length - 1, 0)
  const [range, setRange] = useState<[number, number]>([0, maxIndex])
  // Reset to the full range whenever the dataset changes size.
  const [prevMax, setPrevMax] = useState(maxIndex)
  if (prevMax !== maxIndex) {
    setPrevMax(maxIndex)
    setRange([0, maxIndex])
  }
  // The slider stays on `range` (instant), but the heavy recompute below derives
  // from the debounced value so dragging doesn't refacet on every step.
  const debouncedRange = useDebouncedValue(range, 25)
  const visibleRows = useMemo(
    () => sortedRows.slice(debouncedRange[0], debouncedRange[1] + 1),
    [sortedRows, debouncedRange]
  )
  const { resolvedTheme } = useTheme()
  // The mount-time mode, used to pick the initial style in the one-time init
  // effect. Later changes are handled by the dedicated theme-swap effect below.
  const initialModeRef = useRef<Mode>(resolvedTheme)
  const appliedModeRef = useRef<Mode | null>(null)

  // Distinct users in a stable order; the index doubles as the palette slot and
  // the cluster-property key (u<i>) carried on each map feature.
  const userList = useMemo(
    () => Array.from(new Set(rows.map(userLabel))),
    [rows]
  )
  const userIndex = useMemo(() => {
    const map = new Map<string, number>()
    userList.forEach((user, i) => map.set(user, i))
    return map
  }, [userList])

  // Distinct users for the Users panel.
  const users = useMemo(() => buildUsers(rows), [rows])
  // Users whose connections are hidden from the map.
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const toggleUser = (user: string) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(user)) next.delete(user)
      else next.add(user)
      return next
    })

  // Connections surviving the hard filters: the timeline range and any hidden
  // users. The categories panel and the map both derive from these, so hiding a
  // user or narrowing the timeline removes their values from the panel entirely
  // (a hard filter), unlike the category toggles which only hide map markers.
  const baseRows = useMemo(
    () => visibleRows.filter((row) => !hidden.has(userLabel(row))),
    [visibleRows, hidden]
  )

  // Everything below derives from a single precomputed pass over the base rows:
  // enrichment, coordinates, user, and per-category values/keys.
  const prepared = useMemo(
    () => prepareRows(baseRows, enrichment, crowdsec),
    [baseRows, enrichment, crowdsec]
  )

  // Faceted category filters, derived from the hard-filtered connections so the
  // panel reflects what the timeline and user filters leave behind.
  const facets = useMemo(() => buildFacets(prepared), [prepared])

  // The category values the user has explicitly deselected, keyed "label::value".
  // Only explicit choices are stored; the cascade below is derived from them, so
  // reselecting a value automatically reverses the cascade it triggered.
  const [deselected, setDeselected] = useState<Set<string>>(new Set())
  // `checked` is the value's current (effective) state: a click on a ticked box
  // deselects it, a click on an unticked box reselects it.
  const toggleCategory = (key: string, checked: boolean) =>
    setDeselected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  const toggleCategoryAll = (values: FacetValue[], select: boolean) =>
    setDeselected((prev) => {
      const next = new Set(prev)
      for (const { key } of values) {
        if (select) next.delete(key)
        else next.add(key)
      }
      return next
    })

  const effectiveDeselected = useMemo(
    () => computeEffectiveDeselected(prepared, deselected),
    [prepared, deselected]
  )

  // Connections grouped by exact coordinate, feeding the clustered source.
  const groups = useMemo(
    () => buildGroups(prepared, deselected),
    [prepared, deselected]
  )

  // The connections passing every active filter, independent of whether they
  // resolved to coordinates. Drives the timeline's "showing N" count.
  const filteredRows = useMemo(
    () => passingRows(prepared, effectiveDeselected),
    [prepared, effectiveDeselected]
  )

  // Whether any sign-in resolved to coordinates at all, ignoring filters. When
  // nothing did there is nothing to map, so we show an empty state in place of
  // the map rather than a blank globe.
  const hasLocations = useMemo(
    () => hasAnyLocation(rows, enrichment),
    [rows, enrichment]
  )

  // How many connections in the dataset have no coordinates and so can't be
  // drawn. When some are missing we warn that the map is an incomplete view.
  const missingLocation = useMemo(
    () => countWithoutLocation(rows, enrichment),
    [rows, enrichment]
  )

  // Initialise the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle(initialModeRef.current),
      center: [0, 20],
      zoom: 1.4,
      attributionControl: false,
      renderWorldCopies: false,
    })
    appliedModeRef.current = initialModeRef.current
    map.doubleClickZoom.disable()
    map.addControl(new maplibregl.NavigationControl(), "bottom-left")
    map.on("load", () => setMapReady(true))
    map.on("click", () => setSelectedKeys([]))
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  // Swap the basemap when the colour scheme changes. Only the raster tiles
  // differ, so update them in place; this keeps the cluster source, layer, and
  // DOM markers intact (setStyle would drop them).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || appliedModeRef.current === resolvedTheme) return
    const source = map.getSource(BASEMAP_SOURCE) as
      | maplibregl.RasterTileSource
      | undefined
    if (!source) return
    source.setTiles(basemapTiles(resolvedTheme))
    appliedModeRef.current = resolvedTheme
  }, [resolvedTheme, mapReady])

  // Keep the values the render handler reads fresh without recreating it.
  useEffect(() => {
    const byKey = new Map<string, LocationGroup>()
    for (const group of groups) byKey.set(group.key, group)
    groupsByKeyRef.current = byKey
  }, [groups])
  useEffect(() => {
    colorForRef.current = colorFor
  }, [colorFor])

  // Manage the clustered source, its hit layer, and the DOM markers that render
  // clusters and single points. Re-runs when the user set changes (the cluster
  // properties depend on it).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const clusterProperties: Record<string, unknown> = {
      total: ["+", ["get", "total"]],
    }
    userList.forEach((_, i) => {
      clusterProperties[`u${i}`] = ["+", ["coalesce", ["get", `u${i}`], 0]]
    })

    // Reconcile DOM markers with the clusters/points in the current viewport.
    const updateMarkers = () => {
      const source = map.getSource(SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined
      if (!source) return
      const next: Record<string, maplibregl.Marker> = {}
      for (const feature of map.querySourceFeatures(SOURCE_ID)) {
        const props = feature.properties as Record<string, number | string>
        const coords = (feature.geometry as GeoJSON.Point).coordinates as [
          number,
          number,
        ]
        let id: string
        if (props.cluster) {
          id = `c${props.cluster_id}`
          if (next[id]) continue
          let marker = markersRef.current[id]
          if (!marker) {
            const colors: string[] = []
            userList.forEach((user, i) => {
              if (Number(props[`u${i}`] ?? 0) > 0)
                colors.push(colorForRef.current(user))
            })
            // Sized by connection volume, but labelled with the number of
            // points (distinct locations) clustered here.
            const total = Number(props.total ?? props.point_count)
            const points = Number(props.point_count ?? 0)
            const el = pieElement(colors, total, abbreviate(points))
            el.addEventListener("click", (event) => {
              event.stopPropagation()
              source
                .getClusterExpansionZoom(props.cluster_id as number)
                .then((zoom) => map.easeTo({ center: coords, zoom }))
            })
            marker = new maplibregl.Marker({ element: el }).setLngLat(coords)
          }
          next[id] = marker
        } else {
          id = `p${props.groupKey}`
          if (next[id]) continue
          const group = groupsByKeyRef.current.get(props.groupKey as string)
          if (!group) continue
          let marker = markersRef.current[id]
          if (!marker) {
            const el = pointElement(group, colorForRef.current)
            el.addEventListener("click", (event) => {
              event.stopPropagation()
              setSelectedKeys((keys) =>
                keys.includes(group.key)
                  ? keys.filter((k) => k !== group.key)
                  : [...keys, group.key]
              )
            })
            marker = new maplibregl.Marker({ element: el }).setLngLat(coords)
          }
          next[id] = marker
        }
        if (!markersRef.current[id]) next[id].addTo(map)
      }
      for (const id in markersRef.current) {
        if (!next[id]) markersRef.current[id].remove()
      }
      markersRef.current = next
    }

    const onRender = () => {
      if (map.isSourceLoaded(SOURCE_ID)) updateMarkers()
    }

    const setup = () => {
      if (!map.isStyleLoaded()) {
        map.once("styledata", setup)
        return
      }
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: buildFeatures([...groupsByKeyRef.current.values()], userIndex),
          cluster: true,
          clusterRadius: 60,
          clusterMaxZoom: 14,
          clusterProperties,
        })
        map.addLayer({
          id: HIT_LAYER,
          type: "circle",
          source: SOURCE_ID,
          paint: { "circle-radius": 0, "circle-opacity": 0 },
        })
      }
      updateMarkers()
    }

    map.on("render", onRender)
    setup()

    return () => {
      map.off("render", onRender)
      for (const id in markersRef.current) markersRef.current[id].remove()
      markersRef.current = {}
      // On a full unmount (e.g. switching to the table view) the map is already
      // torn down by the init effect's cleanup, leaving its style undefined;
      // getLayer/getSource would then throw. Only touch them while it's alive.
      if ((map as unknown as { _removed?: boolean })._removed) return
      if (map.getLayer(HIT_LAYER)) map.removeLayer(HIT_LAYER)
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
    }
  }, [mapReady, userList, userIndex])

  // Push fresh geometry to the source as the filters/timeline change. The render
  // handler redraws markers once the source finishes reloading.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined
    if (source) source.setData(buildFeatures(groups, userIndex))
  }, [groups, userIndex, mapReady])

  // Fit to all points the first time we have data.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || fittedRef.current || groups.length === 0) return
    const bounds = new maplibregl.LngLatBounds()
    groups.forEach((g) => bounds.extend([g.lng, g.lat]))
    map.fitBounds(bounds, { padding: 96, maxZoom: 9, duration: 0 })
    fittedRef.current = true
  }, [groups, mapReady])

  // The selected points as they exist in the current (filtered) groups, so each
  // popover stays in sync with the timeline and closes if its point drops out.
  const liveSelected = useMemo(
    () =>
      selectedKeys
        .map((key) => groups.find((g) => g.key === key))
        .filter((g): g is LocationGroup => Boolean(g)),
    [selectedKeys, groups]
  )

  // Track each open popover's screen position so it can float above its point,
  // following the map as it pans and zooms.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || liveSelected.length === 0) {
      setAnchors({})
      return
    }
    const update = () => {
      const next: Record<string, { x: number; y: number }> = {}
      for (const group of liveSelected) {
        const p = map.project([group.lng, group.lat])
        next[group.key] = { x: p.x, y: p.y }
      }
      setAnchors(next)
    }
    update()
    map.on("move", update)
    return () => {
      map.off("move", update)
    }
  }, [liveSelected, mapReady])

  // Nothing was enriched with coordinates: there is no map to draw, so show an
  // empty state instead. (The container below never mounts, so the map is not
  // initialised until coordinates exist.)
  if (!hasLocations) {
    return <MapEmptyState onConfigureKeys={onConfigureKeys} />
  }

  return (
    <div className="fixed inset-0">
      <div ref={containerRef} className="size-full" />

      {focusActive ? (
        <div className="absolute top-28 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-2xl bg-popover px-4 py-2 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10">
          <span>
            Showing {quantity(rows.length, "connection")} from one finding.
          </span>
          <Button size="sm" variant="outline" onClick={onClearFocus}>
            Show all
          </Button>
        </div>
      ) : null}

      {missingLocation > 0 ? (
        <div
          className={cn(
            "absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-popover px-4 py-2 text-sm text-popover-foreground shadow-lg ring-1 ring-amber-500/30",
            focusActive ? "top-44" : "top-28"
          )}
        >
          <TriangleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-500" />
          <span>
            {quantity(missingLocation, "connection")}{" "}
            {missingLocation === 1 ? "has" : "have"} no location and{" "}
            {missingLocation === 1 ? "isn't" : "aren't"} shown on the map.
          </span>
        </div>
      ) : null}

      {groups.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="pointer-events-auto rounded-2xl bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10">
            No connections match the current filters.
          </div>
        </div>
      ) : null}

      {liveSelected.map((group) => {
        const anchor = anchors[group.key]
        if (!anchor) return null
        return (
          <div
            key={group.key}
            className="pointer-events-none absolute z-10"
            style={{
              left: anchor.x,
              top: anchor.y - markerRadius(group.connections.length) - 12,
            }}
          >
            <div className="pointer-events-auto -translate-x-1/2 -translate-y-full">
              <DetailsPanel
                group={group}
                colorFor={colorFor}
                onClose={handleCloseDetails}
              />
            </div>
          </div>
        )
      })}

      {users.length > 0 ? (
        <UsersPanel
          users={users}
          hidden={hidden}
          colorFor={colorFor}
          onToggle={toggleUser}
          onToggleAll={(select) =>
            setHidden(select ? new Set() : new Set(users.map((u) => u.label)))
          }
          open={usersOpen}
          onToggleOpen={() => setUsersOpen((o) => !o)}
        />
      ) : null}

      {facets.length > 0 ? (
        <CategoriesPanel
          facets={facets}
          deselected={effectiveDeselected}
          onToggle={toggleCategory}
          onToggleAll={toggleCategoryAll}
          open={categoriesOpen}
          onToggleOpen={() => setCategoriesOpen((o) => !o)}
        />
      ) : null}

      {sortedRows.length > 1 ? (
        <Timeline
          rows={sortedRows}
          range={range}
          count={filteredRows.length}
          onRangeChange={setRange}
          open={timelineOpen}
          onToggleOpen={() => setTimelineOpen((o) => !o)}
        />
      ) : null}
    </div>
  )
}
