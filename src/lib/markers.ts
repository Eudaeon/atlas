// Building blocks for the map's DOM markers and the GeoJSON fed to MapLibre's
// clustered source. Markers are SVG pies/donuts drawn from per-user colours.

import { type LocationGroup, userCounts } from "@/lib/facets"

// One slice of the donut, expressed as an SVG path between two fractions.
function donutSegment(
  start: number,
  end: number,
  r: number,
  r0: number,
  color: string
): string {
  if (end - start === 1) end -= 0.00001
  const a0 = 2 * Math.PI * (start - 0.25)
  const a1 = 2 * Math.PI * (end - 0.25)
  const x0 = Math.cos(a0)
  const y0 = Math.sin(a0)
  const x1 = Math.cos(a1)
  const y1 = Math.sin(a1)
  const largeArc = end - start > 0.5 ? 1 : 0
  return `<path d="M ${r + r0 * x0} ${r + r0 * y0} L ${r + r * x0} ${
    r + r * y0
  } A ${r} ${r} 0 ${largeArc} 1 ${r + r * x1} ${r + r * y1} L ${
    r + r0 * x1
  } ${r + r0 * y1} A ${r0} ${r0} 0 ${largeArc} 0 ${r + r0 * x0} ${
    r + r0 * y0
  }" fill="${color}" />`
}

// Marker radius scales with the volume of connections at a point.
export function markerRadius(total: number): number {
  return total >= 1000 ? 22 : total >= 100 ? 18 : total >= 10 ? 14 : 11
}

export function abbreviate(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 9950 ? 0 : 1)}k` : String(n)
}

// Builds a marker SVG. Slices are equal-sized, one per colour. Without a label
// it is a solid pie (a single location); with a label it becomes a donut with
// the count in the centre (a cluster of locations).
export function pieElement(
  colors: string[],
  total: number,
  label?: string
): HTMLElement {
  // Clusters (those carrying a count label) are drawn a little larger than
  // single-location points so they read clearly as an aggregate.
  const r = markerRadius(total) + (label ? 5 : 0)
  const w = r * 2
  const r0 = label ? r * 0.58 : 0
  const fill = colors[0] ?? "hsl(0 0% 60%)"

  const shape =
    colors.length <= 1
      ? r0 > 0
        ? donutSegment(0, 1, r, r0, fill)
        : `<circle cx="${r}" cy="${r}" r="${r}" fill="${fill}" />`
      : colors
          .map((color, i) =>
            donutSegment(
              i / colors.length,
              (i + 1) / colors.length,
              r,
              r0,
              color
            )
          )
          .join("")

  // A solid dark disc fills the donut hole so the white count reads clearly
  // against it instead of the basemap showing through.
  const hub =
    label && r0 > 0
      ? `<circle cx="${r}" cy="${r}" r="${r0}" fill="#18181b" />`
      : ""

  const text = label
    ? `<text x="${r}" y="${r}" text-anchor="middle" dominant-baseline="central" style="font:600 ${
        r >= 18 ? 12 : 10
      }px var(--font-sans);fill:#fff;pointer-events:none">${label}</text>`
    : ""

  const wrapper = document.createElement("div")
  wrapper.style.cursor = "pointer"
  wrapper.innerHTML = `
    <svg width="${w}" height="${w}" viewBox="0 0 ${w} ${w}"
      style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">
      ${shape}
      ${hub}
      ${text}
    </svg>`
  return wrapper.firstElementChild as HTMLElement
}

// A single location: a solid pie split into one equal slice per distinct user.
export function pointElement(
  group: LocationGroup,
  colorFor: (user: string) => string
): HTMLElement {
  const colors = userCounts(group).map(([user]) => colorFor(user))
  return pieElement(colors, group.connections.length)
}

// One GeoJSON point per location. Each carries its per-user counts (u<i>, keyed
// by the user's palette index) and a `total` connection count, which the
// clustered source sums so a cluster marker can be drawn as a pie.
export function buildFeatures(
  groups: LocationGroup[],
  userIndex: Map<string, number>
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: groups.map((group) => {
      const properties: Record<string, number | string> = {
        groupKey: group.key,
        total: group.connections.length,
      }
      for (const [user, count] of userCounts(group)) {
        const i = userIndex.get(user)
        if (i !== undefined) properties[`u${i}`] = count
      }
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [group.lng, group.lat] },
        properties,
      }
    }),
  }
}
