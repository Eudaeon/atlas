import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  LngLatBounds,
  Map as MapLibre,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
} from "maplibre-gl"
// maplibre looks for its worker next to its own file, which after a build is a
// bundle of everything and has no worker beside it. On Cloudflare that address
// hits the fallback and the worker loads an HTML page. Vite is told to build
// the worker here instead, and maplibre is handed where it landed.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"
import type {
  GeoJSONSource,
  RasterTileSource,
  StyleSpecification,
} from "maplibre-gl"
import type { FeatureCollection } from "geojson"
import {
  IconAlertTriangle,
  IconChevronRight,
  IconMapPinOff,
} from "@tabler/icons-react"
import "maplibre-gl/dist/maplibre-gl.css"

import { Alert, AlertTitle } from "@/components/ui/alert"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { CategoriesPanel, Timeline, UsersPanel } from "@/components/map-panels"
import type { Person } from "@/components/map-panels"
import { ConnectionDetails } from "@/components/connection-details"
import { useIpInfo } from "@/hooks/use-ip-info"
import { useKeys } from "@/hooks/use-keys"
import { many } from "@/lib/analysis"
import { ipInfo } from "@/lib/ip-lookup"
import type { LogRow } from "@/lib/entra-logs"
import { abbreviate, pieElement } from "@/lib/markers"
import { arrowsFor } from "@/lib/off-screen"
import type { Arrow } from "@/lib/off-screen"
import { pointsFrom, userColor, userOf } from "@/lib/connection-points"
import type { Point } from "@/lib/connection-points"
import { buildFacets, passing, prepare, spreadDeselected } from "@/lib/facets"
import type { FacetValue } from "@/lib/facets"

setWorkerUrl(workerUrl)

// Esri's grey canvas. CARTO's basemaps now stamp "API KEY REQUIRED" across
// every tile past the first few zooms; these are the same kind of quiet map and
// still need no key. Note the y before the x.
const tiles = (dark: boolean) => [
  `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${dark ? "Dark" : "Light"}_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
]

const isDark = () => document.documentElement.classList.contains("dark")

/** Raster tiles rather than a vector style: two lines of style, no key, and a
light and a dark version of the same map. */
const basemap = (dark: boolean): StyleSpecification => ({
  version: 8,
  sources: {
    base: {
      type: "raster",
      tiles: tiles(dark),
      tileSize: 256,
      // The grey canvas stops at 16. Past that maplibre stretches what it has
      // rather than asking for tiles that are not there.
      maxzoom: 16,
      attribution:
        'Esri, <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: "base", type: "raster", source: "base" }],
})

/** How many users get a slice of their own in a cluster pie. MapLibre sums one
expression per slot across every feature it clusters, so this is the width of
that work: a tenant with five thousand accounts would otherwise cost five
thousand sums per point.

ponytail: the busiest 64, and everyone else in one grey slice. Raise it if a
cluster starts reading as mostly grey. */
const slotLimit = 64

/** One feature per address, carrying each user's count under their palette slot.
The clustered source sums those slots, which is what lets a cluster be drawn as
a pie of everyone inside it. Everyone past the cap shares the last slot, so a
count is added rather than written. */
const features = (
  points: Array<Point>,
  slot: Map<string, number>
): FeatureCollection => ({
  type: "FeatureCollection",
  features: points.map((point) => {
    const properties: Record<string, number | string> = {
      id: point.id,
      count: point.count,
    }
    for (const visitor of point.visitors) {
      const key = `u${slot.get(visitor.user) ?? slot.size}`
      properties[key] = Number(properties[key] ?? 0) + visitor.count
    }
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [point.lon, point.lat] },
      properties,
    }
  }),
})

/** An address, sliced by who connected from it. */
const pointPie = (point: Point | undefined) =>
  point === undefined
    ? undefined
    : pieElement(
        point.visitors.map((one) => ({ color: one.color, share: one.count })),
        point.count
      )

/** Several addresses at once, sliced the same way from the sums the source
keeps, and labelled with how many are inside. */
const clusterPie = (props: Record<string, any>, colors: Array<string>) => {
  const slices = []
  for (let at = 0; at < colors.length; at++) {
    const share = Number(props[`u${at}`] ?? 0)
    if (share > 0) slices.push({ color: colors[at], share })
  }
  if (slices.length === 0) return undefined
  return pieElement(
    slices,
    Number(props.count ?? 0),
    abbreviate(Number(props.point_count ?? 0))
  )
}

/** How far in from each side of the map an arrow for an off-screen address
sits, and how many of them are worth drawing at once. The top is the deep one:
the files button and the view switch float over the map there.

The arrows are drawn over the panels rather than around them. A panel is a
third of the map wide when it is open, and keeping clear of one would push the
arrows into a huddle in the middle. */
const edgeInset = { top: 26, right: 26, bottom: 26, left: 26 }

/** What the app draws over the top of the map, which an arrow drops below
rather than sitting behind. Marked in the markup, so moving a button does not
mean coming back here for its size. */
const overMap = "[data-over-map]"

/** The panels, measured. These sit still while the map moves underneath them,
so a pan reuses the last measurement rather than laying the page out again on
every frame. */
const panelsOverMap = () =>
  [...document.querySelectorAll(overMap)].map((one) =>
    one.getBoundingClientRect()
  )

/** The cards, measured. These do move with the map, because they are anchored
to their addresses, so they are the one thing worth measuring per frame. They
live in maplibre's own DOM, so they are found by its class rather than marked
like the rest. */
const cardsOverMap = () =>
  [...document.querySelectorAll(".maplibregl-popup")].map((one) =>
    one.getBoundingClientRect()
  )

/** How close two arrows have to be before they become one. */
const edgeRoom = 44

/** The gap left around whatever the arrow has to keep clear of, measured from
the middle of the arrow: half a chip plus a little air. */
const edgeGap = 18

/** One address the current view cuts off, with the arrow that points at it. */
type OffScreen = Arrow<Point>

const toggle = (current: ReadonlySet<string>, value: string) => {
  const next = new Set(current)
  if (!next.delete(value)) next.add(value)
  return next
}

/** Where the records came from, one pie per address. The panels take users,
categories and time out of the picture; whatever survives is what is drawn. */
export function ConnectionMap({ rows }: { rows: Array<LogRow> }) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibre>(null)
  const [ready, setReady] = useState(false)
  // The open cards, front-most last. An address can be read next to another,
  // so this is a list rather than the one selection it used to be.
  const [opened, setOpened] = useState<Array<string>>([])
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const [deselected, setDeselected] = useState<ReadonlySet<string>>(new Set())
  const [usersOpen, setUsersOpen] = useState(true)
  const [categoriesOpen, setCategoriesOpen] = useState(true)
  const [timelineOpen, setTimelineOpen] = useState(true)
  const version = useIpInfo()

  // The number keys fold the panels away, as their flaps say. Bare ones only:
  // alt and a digit switches view, and both handlers sit on the window, so
  // without this alt-2 on the map view folded the categories panel on its way
  // past.
  useKeys((event, typing) => {
    if (typing || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === "1") setUsersOpen((open) => !open)
    if (event.key === "2") setCategoriesOpen((open) => !open)
    if (event.key === "3") setTimelineOpen((open) => !open)
  })

  // In time order, because the timeline is an index into this list: one step of
  // the slider is one connection.
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (a.Date < b.Date ? -1 : 1)),
    [rows]
  )
  const last = Math.max(sorted.length - 1, 0)
  const [range, setRange] = useState<[number, number]>([0, last])
  // A new upload is a new timeline, so open it back up to the whole of it.
  const [wasLast, setWasLast] = useState(last)
  if (wasLast !== last) {
    setWasLast(last)
    setRange([0, last])
  }
  // The slider follows the finger; the work behind it waits for a pause.
  const settled = useDeferredValue(range)
  const inTime = useMemo(
    () => sorted.slice(settled[0], settled[1] + 1),
    [sorted, settled]
  )

  // Everyone in the dataset, listed whatever the filters say, so the panel does
  // not empty itself as it is used.
  const users = useMemo(() => {
    const tally = new Map<string, Person>()
    for (const row of rows) {
      const user = userOf(row)
      const seen = tally.get(user)
      if (seen === undefined) {
        tally.set(user, {
          user,
          name: row.Name || user,
          count: 1,
          color: userColor(user),
        })
      } else seen.count += 1
    }
    return [...tally.values()].sort((a, b) => b.count - a.count)
  }, [rows])

  // Hiding a user is a hard filter: the categories panel counts what is left,
  // not what the whole dataset holds.
  //
  // ponytail: the whole chain reruns on every lookup that lands, which is once
  // a second while a run is on. Slice it into a worker the day an upload is big
  // enough for that to show.
  const kept = useMemo(
    () => inTime.filter((row) => !hidden.has(userOf(row))),
    [inTime, hidden]
  )
  // The version is a dependency rather than an argument: `prepare` and the
  // count below read the store, and a lookup landing has to rebuild both.
  const prepared = useMemo(() => prepare(kept), [kept, version])
  const facets = useMemo(() => buildFacets(prepared), [prepared])
  const spread = useMemo(
    () => spreadDeselected(prepared, deselected),
    [prepared, deselected]
  )
  const shown = useMemo(
    () => pointsFrom(passing(prepared, spread)),
    [prepared, spread]
  )
  // A value is switched off by sitting in the set, so selecting takes keys out
  // of it and deselecting puts them in.
  const deselect = (keys: Array<string>, off: boolean) =>
    setDeselected((current) => {
      const next = new Set(current)
      for (const key of keys) {
        if (off) next.add(key)
        else next.delete(key)
      }
      return next
    })

  // What the lookups have come back with: how many records can be drawn at all,
  // and how many were looked up and have no place to go.
  const located = useMemo(() => {
    let placed = 0
    let missing = 0
    for (const row of rows) {
      const info = ipInfo(row["IP Address"])
      if (info === undefined) continue
      if (info.coordinates === "") missing += 1
      else placed += 1
    }
    return { placed, missing }
  }, [rows, version])

  // The busiest users get a slot each, so a cluster can be turned back into a
  // pie. `users` is already in count order, so the slice is the top of it.
  const slots = useMemo(
    () => new Map(users.slice(0, slotLimit).map((one, at) => [one.user, at])),
    [users]
  )
  // Index-aligned with the slots, plus the grey everyone past the cap shares.
  const slotColors = useMemo(
    () => [
      ...users.slice(0, slotLimit).map((one) => one.color),
      "hsl(0, 0%, 60%)",
    ],
    [users]
  )
  // What the render handler reads. It outlives any one render, so it takes the
  // latest points through a ref rather than being rebuilt for each of them.
  const latest = useRef(shown)
  latest.current = shown
  const markers = useRef(new Map<string, Marker>())

  useEffect(() => {
    if (container.current === null) return
    const drawn = new MapLibre({
      container: container.current,
      style: basemap(isDark()),
      center: [10, 30],
      zoom: 1.2,
      attributionControl: { compact: true },
      doubleClickZoom: false,
      renderWorldCopies: false,
    })
    map.current = drawn
    // Bottom left: the bottom right belongs to the attribution.
    drawn.addControl(
      new NavigationControl({ showCompass: false }),
      "bottom-left"
    )
    drawn.on("load", () => setReady(true))
    // Clicking the map itself, rather than a marker, puts the cards away. The
    // popups sit outside the canvas maplibre listens on, so reading one never
    // dismisses it.
    drawn.on("click", () => setOpened([]))

    // The theme toggle writes a class on <html>, so watch that rather than
    // asking the toggle to tell the map about it. Only the tiles change: the
    // markers take their colours from the page.
    const themed = new MutationObserver(() => {
      drawn.getSource<RasterTileSource>("base")?.setTiles(tiles(isDark()))
    })
    themed.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })

    return () => {
      themed.disconnect()
      drawn.remove()
      map.current = null
      setReady(false)
    }
  }, [])

  // The markers are DOM, not a circle layer: an SVG pie cannot be expressed as
  // paint. MapLibre still does the clustering, and the pies are drawn from what
  // its source has at the current zoom.
  useEffect(() => {
    const drawn = map.current
    if (!ready || drawn === null) return

    // Each slot is summed across a cluster, which gives every user's share of
    // it without reading a single record back.
    const clusterProperties: Record<string, unknown> = {
      count: ["+", ["get", "count"]],
    }
    for (let at = 0; at < slotColors.length; at++) {
      clusterProperties[`u${at}`] = ["+", ["coalesce", ["get", `u${at}`], 0]]
    }

    drawn.addSource("points", {
      type: "geojson",
      data: features(latest.current, slots),
      cluster: true,
      clusterRadius: 60,
      clusterMaxZoom: 14,
      clusterProperties,
    })
    // A layer of nothing. Without one the source never loads a tile, and with
    // no tiles there is nothing to ask for markers.
    drawn.addLayer({
      id: "hit",
      type: "circle",
      source: "points",
      paint: { "circle-radius": 0 },
    })

    const draw = () => {
      const source = drawn.getSource<GeoJSONSource>("points")
      if (source === undefined) return
      const next = new Map<string, Marker>()
      // Built once rather than scanned per feature: a busy view asks for a few
      // hundred markers and the point list is as long as the address list.
      const byId = new Map(latest.current.map((one) => [one.id, one]))
      for (const feature of drawn.querySourceFeatures("points")) {
        if (feature.geometry.type !== "Point") continue
        const at = feature.geometry.coordinates as [number, number]
        const props = feature.properties
        const cluster = typeof props.cluster_id === "number"
        const place = String(props.id)
        const key = cluster ? `c${props.cluster_id}` : `p${place}`
        // The same feature turns up once per tile it touches.
        if (next.has(key)) continue

        let marker = markers.current.get(key)
        if (marker === undefined) {
          const element = cluster
            ? clusterPie(props, slotColors)
            : pointPie(byId.get(place))
          if (element === undefined) continue
          element.addEventListener("click", (event) => {
            event.stopPropagation()
            if (!cluster) {
              setOpened((open) =>
                open.includes(place)
                  ? open.filter((one) => one !== place)
                  : [...open, place]
              )
              return
            }
            void source
              .getClusterExpansionZoom(props.cluster_id)
              .then((zoom) => drawn.easeTo({ center: at, zoom }))
              // The cluster can be gone by the time this lands, when a filter
              // replaced the data under it. Then there is nothing to zoom to.
              .catch(() => {})
          })
          marker = new Marker({ element }).setLngLat(at)
          marker.addTo(drawn)
        }
        next.set(key, marker)
      }
      for (const [key, marker] of markers.current) {
        if (!next.has(key)) marker.remove()
      }
      markers.current = next
    }

    const onRender = () => {
      if (drawn.isSourceLoaded("points")) draw()
    }
    drawn.on("render", onRender)
    draw()

    return () => {
      drawn.off("render", onRender)
      for (const marker of markers.current.values()) marker.remove()
      markers.current.clear()
      if (drawn.getLayer("hit")) drawn.removeLayer("hit")
      if (drawn.getSource("points")) drawn.removeSource("points")
    }
  }, [ready, slots, slotColors])

  // New data means new pies: an address can gain a user, and a cluster id can
  // come back around on somewhere else entirely. Dropping the markers has the
  // render handler draw every one of them again from what is now there.
  useEffect(() => {
    if (!ready) return
    map.current
      ?.getSource<GeoJSONSource>("points")
      ?.setData(features(shown, slots))
    for (const marker of markers.current.values()) marker.remove()
    markers.current.clear()
  }, [shown, slots, ready])

  // Frame the addresses the first time a dataset has any. Filtering afterwards
  // leaves the camera where it was put.
  const fitted = useRef(false)
  useEffect(() => {
    fitted.current = false
  }, [rows])
  useEffect(() => {
    if (!ready || fitted.current || shown.length === 0) return
    const bounds = new LngLatBounds()
    for (const point of shown) bounds.extend([point.lon, point.lat])
    map.current?.fitBounds(bounds, { padding: 96, maxZoom: 9, duration: 0 })
    fitted.current = true
  }, [shown, ready])

  // What the arrows are worked out from. Every point is projected on every
  // frame of a pan, so this is the one list on the map with a hard length.
  //
  // ponytail: the busiest 500. `clump` draws one arrow per stretch of edge and
  // hands it the count of everything behind it, so a quiet address in a busy
  // direction was never going to be the one drawn. Raise it if an arrow goes
  // missing on a sparse map.
  const forArrows = useMemo(
    () =>
      shown.length <= 500
        ? shown
        : [...shown].sort((a, b) => b.count - a.count).slice(0, 500),
    [shown]
  )

  // The addresses off the side of the view, as arrows around the edge of it.
  // Panning is the only thing that changes this, so it is worked out from the
  // map itself rather than from a render.
  const [offScreen, setOffScreen] = useState<Array<OffScreen>>([])
  useEffect(() => {
    const drawn = map.current
    if (!ready || drawn === null) return
    // The map's own box and the panels over it hold still through a pan, so
    // they are measured when something moves them and reused in between. Only
    // the cards are measured per frame, because they ride the map.
    let box = drawn.getContainer().getBoundingClientRect()
    let panels = panelsOverMap()
    const update = () =>
      setOffScreen(
        arrowsFor(
          forArrows,
          (point) => drawn.project([point.lon, point.lat]),
          box,
          [...panels, ...cardsOverMap()],
          { inset: edgeInset, gap: edgeGap, room: edgeRoom }
        )
      )
    const remeasure = () => {
      box = drawn.getContainer().getBoundingClientRect()
      panels = panelsOverMap()
      update()
    }
    update()
    // A panel takes its 300ms to slide, and where it comes to rest is what the
    // arrows have to keep clear of. The timer is for a slide cut short by
    // another click, which ends without a transitionend.
    const slid = (event: TransitionEvent) => {
      if (event.target instanceof Element && event.target.closest(overMap)) {
        remeasure()
      }
    }
    document.addEventListener("transitionend", slid)
    const settle = setTimeout(remeasure, 400)
    drawn.on("move", update)
    // A resize moves the edges without moving the map, and the arrows were
    // left sitting where the old edges used to be.
    drawn.on("resize", remeasure)
    return () => {
      clearTimeout(settle)
      document.removeEventListener("transitionend", slid)
      drawn.off("move", update)
      drawn.off("resize", remeasure)
    }
  }, [ready, forArrows, usersOpen, categoriesOpen, timelineOpen, opened])

  // Only the open addresses still on the map: a filter can take one away while
  // its card is up. A set rather than a scan per card: this is read on every
  // render, and a pan re-renders on every frame.
  const onMap = useMemo(() => new Set(shown.map((one) => one.id)), [shown])
  const placed = opened.filter((id) => onMap.has(id))
  // `shown` is rebuilt on every lookup that lands, so the effect below keys off
  // which cards are up and in what order, not off the points themselves.
  const stack = placed.join(" ")
  const close = (id: string) =>
    setOpened((open) => open.filter((one) => one !== id))

  const cards = useRef(
    new Map<string, { popup: Popup; node: HTMLDivElement }>()
  )
  const [bubbles, setBubbles] = useState<ReadonlyMap<string, HTMLDivElement>>(
    new Map()
  )

  // The popups are maplibre's, so they track their addresses as the map moves.
  // React fills each one through a portal, which keeps the card live while
  // lookups land.
  useEffect(() => {
    const drawn = map.current
    if (drawn === null) return
    const live = cards.current
    for (const [id, card] of live) {
      if (!placed.includes(id)) {
        card.popup.remove()
        live.delete(id)
      }
    }
    for (const id of placed) {
      if (live.has(id)) continue
      const spot = shown.find((one) => one.id === id)
      if (spot === undefined) continue
      const node = document.createElement("div")
      // The card stands clear of its marker, so the point it is about is never
      // behind it, but on whichever side has the room: a marker up under the
      // toolbar used to get the strip above it and nothing else, which left the
      // connections list a couple of lines to scroll in. The map runs the full
      // height of the window with the toolbar floating over the top, so the
      // ceiling is the toolbar rather than the map's own edge.
      const at = drawn.project([spot.lon, spot.lat]).y
      const box = drawn.getContainer().getBoundingClientRect()
      const toolbar =
        document.querySelector(`header${overMap}`)?.getBoundingClientRect()
          .bottom ?? 0
      const above = at + box.top - toolbar - 16
      const below = box.height - at - 16
      // Squeezed both ways, the card still gets enough to read and reaches over
      // whatever is in the way rather than shrinking to a strip.
      const room = Math.max(above, below, 256)
      const popup = new Popup({
        closeButton: false,
        closeOnMove: false,
        anchor: below > above ? "top" : "bottom",
        offset: 14,
        maxWidth: "none",
        className: "connection-popup",
      })
        .setLngLat([spot.lon, spot.lat])
        .setDOMContent(node)
        .addTo(drawn)
      popup.getElement().style.setProperty("--room", `${Math.round(room)}px`)
      popup.on("close", () => close(id))
      // Anywhere on a card raises it, buttons included: `pointerdown` beats the
      // click those handle, so the card is already on top when they run.
      popup
        .getElement()
        .addEventListener("pointerdown", () =>
          setOpened((open) => [...open.filter((one) => one !== id), id])
        )
      live.set(id, { popup, node })
    }
    // Stacking order is list order, so the last card touched reads over the
    // rest. maplibre gives them all the same z-index otherwise.
    placed.forEach((id, at) => {
      const element = live.get(id)?.popup.getElement()
      if (element !== undefined) element.style.zIndex = String(30 + at)
    })
    setBubbles(new Map([...live].map(([id, card]) => [id, card.node])))
  }, [stack, ready])

  // The popups live in maplibre's DOM, not React's, so leaving the map has to
  // take them down by hand.
  useEffect(() => {
    const live = cards.current
    return () => {
      for (const card of live.values()) card.popup.remove()
      live.clear()
    }
  }, [])

  return (
    <>
      {/* Absolute rather than fixed, and with no z-index: a fixed box is a
      stacking context of its own in every engine, which would trap the cards
      inside the map and paint the panels over them. The page never scrolls, so
      this covers the window either way. */}
      <div className="absolute inset-0">
        <div ref={container} className="size-full" />
      </div>

      {/* Nothing on the map, either because no lookup has come back with a
      place yet or because the panels have taken every marker off. */}
      {shown.length === 0 ? (
        <div className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon" className="bg-input">
                <IconMapPinOff />
              </EmptyMedia>
              <EmptyTitle>
                {located.placed === 0
                  ? "Nowhere to put yet"
                  : "Nothing left showing"}
              </EmptyTitle>
              <EmptyDescription>
                {located.placed === 0
                  ? "Addresses appear here as their lookups come back."
                  : "No connections match the current filters."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : null}

      {/* In the flow under the toolbar rather than at a measured distance from
      the top: the toolbar is two rows on a wide window and four on a narrow
      one, and this clears it either way. */}
      {located.missing > 0 ? (
        <Alert className="relative z-20 w-auto self-center text-warning shadow-lg">
          <IconAlertTriangle />
          <AlertTitle>
            {located.missing.toLocaleString()} connections have no location.
          </AlertTitle>
        </Alert>
      ) : null}

      {/* The same layer as the panels, which are drawn after this: an arrow
      keeps out of their way rather than sitting over them. */}
      <div className="pointer-events-none fixed inset-0 z-20">
        {offScreen.map(({ of: point, count, over, x, y, angle }) => (
          <button
            key={point.id}
            type="button"
            title={
              over === 1
                ? `${point.ip}: ${many(count, "connection")} off screen`
                : `${point.ip} and ${many(over - 1, "more address")}: ${many(count, "connection")} off screen`
            }
            aria-label={`Move to ${point.ip}, off screen`}
            style={{ left: x, top: y }}
            onClick={() =>
              map.current?.easeTo({ center: [point.lon, point.lat] })
            }
            // A panel is the same colour as this chip, so the ring and the
            // shadow are what part them.
            className="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-full bg-popover py-0.5 pr-1.5 pl-1 text-[0.625rem] font-medium text-popover-foreground shadow-lg ring-1 ring-foreground/25 hover:bg-muted"
          >
            <IconChevronRight
              className="size-3.5 shrink-0"
              style={{
                transform: `rotate(${angle}deg)`,
                color: point.visitors[0]?.color,
              }}
            />
            {abbreviate(count)}
          </button>
        ))}
      </div>

      {users.length > 0 ? (
        <UsersPanel
          users={users}
          hidden={hidden}
          toggle={(user) => setHidden((current) => toggle(current, user))}
          toggleAll={(select) =>
            setHidden(
              select ? new Set() : new Set(users.map((one) => one.user))
            )
          }
          open={usersOpen}
          toggleOpen={() => setUsersOpen((open) => !open)}
        />
      ) : null}

      {facets.length > 0 ? (
        <CategoriesPanel
          facets={facets}
          deselected={spread}
          toggle={(key, on) => deselect([key], on)}
          toggleAll={(values: Array<FacetValue>, select) =>
            deselect(
              values.map((one) => one.key),
              !select
            )
          }
          open={categoriesOpen}
          toggleOpen={() => setCategoriesOpen((open) => !open)}
        />
      ) : null}

      {sorted.length > 1 ? (
        <Timeline
          connections={sorted}
          range={range}
          count={shown.reduce((all, one) => all + one.count, 0)}
          onRange={setRange}
          open={timelineOpen}
          toggleOpen={() => setTimelineOpen((open) => !open)}
        />
      ) : null}

      {placed.map((id) => {
        const spot = shown.find((one) => one.id === id)
        const bubble = bubbles.get(id)
        if (spot === undefined || bubble === undefined) return null
        return createPortal(
          <ConnectionDetails point={spot} close={() => close(id)} />,
          bubble,
          id
        )
      })}
    </>
  )
}
