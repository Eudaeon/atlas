// The connection-faceting pipeline. Everything the map's filter panels and
// markers need is derived from a single precomputed pass over the rows
// (`prepareRows`): the per-category leaf keys, the enrichment lookup, the
// coordinates, and the user label. Facets, the cascade of effective
// deselections, the location groups, and the surviving rows all read from those
// prepared rows instead of recomputing category values four times over.

import { type SignIn, userLabel } from "@/lib/signin"
import {
  connectionType,
  type EnrichmentMap,
  type ProxyData,
} from "@/lib/proxycheck"
import type { CrowdSecData, CrowdSecMap } from "@/lib/crowdsec"
import { text, toNumber } from "@/lib/format"
import { CATEGORIES, leafKey } from "@/lib/categories"

export type Connection = { row: SignIn; user: string }
export type UserEntry = { label: string; name: string; email: string }

export type LocationGroup = {
  key: string
  lat: number
  lng: number
  ip?: string | null
  country?: string | null
  provider?: string | null
  organisation?: string | null
  type?: string | null
  data?: ProxyData
  threat?: CrowdSecData
  connections: Connection[]
}

export type FacetValue = { key: string; value: string; count: number }
// `leaf` is set when a group has only a single value: there is nothing to choose
// between, so the group renders as one direct toggle labelled by its own name
// (e.g. "macOS") rather than an expandable sublevel.
export type FacetGroup = {
  group: string
  count: number
  values: FacetValue[]
  leaf?: FacetValue
}
// `values` is the flat list of every leaf value (used for the X/Y count and the
// category-wide select-all). `groups` is present only for nested categories and
// drives the two-level rendering.
export type Facet = {
  label: string
  values: FacetValue[]
  groups?: FacetGroup[]
}

// A category value as it applies to one row: its leaf display value, its group
// (for nested categories), and the deselect key combining them.
type RowCategory = { value: string; group?: string; key: string }

// A row with everything the pipeline reads precomputed once.
export type PreparedRow = {
  row: SignIn
  data?: ProxyData
  threat?: CrowdSecData
  user: string
  cats: RowCategory[] // index-aligned with CATEGORIES
  lat: number
  lng: number
}

// Precompute, for each row, its enrichment, coordinates, user, and per-category
// values/keys. The rest of the pipeline reuses this so category functions run
// exactly once per row rather than once per derived view.
export function prepareRows(
  rows: SignIn[],
  enrichment: EnrichmentMap,
  crowdsec: CrowdSecMap
): PreparedRow[] {
  return rows.map((row) => {
    const data = row.ipAddress ? enrichment[row.ipAddress] : undefined
    const threat = row.ipAddress ? crowdsec[row.ipAddress] : undefined
    // Evaluate each category's value/group once and compose the key from them,
    // rather than re-running the (sometimes string-splitting) category functions
    // a second time inside leafKey. This is the hottest loop in the app.
    const cats = CATEGORIES.map<RowCategory>((cat) => {
      const value = cat.value(row, data, threat)
      const group = cat.group?.(row, data, threat)
      return { value, group, key: leafKey(cat.label, group, value) }
    })
    return {
      row,
      data,
      threat,
      user: userLabel(row),
      cats,
      lat: toNumber(data?.latitude),
      lng: toNumber(data?.longitude),
    }
  })
}

function sortFacetValues(
  counts: Map<string, number>,
  keyFor: (value: string) => string
): FacetValue[] {
  return (
    [...counts.entries()]
      .map(([value, count]) => ({ key: keyFor(value), value, count }))
      // Always alphabetical/numerical; `numeric` gives natural order so e.g.
      // "10" sorts after "2" and IPs/version numbers read in sequence.
      .sort((a, b) =>
        a.value.localeCompare(b.value, undefined, { numeric: true })
      )
  )
}

// Build the faceted filter panel from the prepared rows. Categories with nothing
// to choose between (a single "Unknown" value) are dropped.
export function buildFacets(prepared: PreparedRow[]): Facet[] {
  const built = CATEGORIES.map<Facet>((cat, i) => {
    if (cat.group) {
      const grouped = new Map<string, Map<string, number>>()
      for (const p of prepared) {
        const { group, value } = p.cats[i]
        const g = group ?? "Unknown"
        let inner = grouped.get(g)
        if (!inner) grouped.set(g, (inner = new Map()))
        inner.set(value, (inner.get(value) ?? 0) + 1)
      }
      const groups: FacetGroup[] = [...grouped.entries()]
        .map(([group, inner]) => {
          const values = sortFacetValues(inner, (value) =>
            leafKey(cat.label, group, value)
          )
          const count = values.reduce((sum, v) => sum + v.count, 0)
          // A single-value group has nothing to expand into, so collapse it to a
          // direct toggle labelled by the group name (keeping the value's key so
          // filtering still targets that value). Categories marked `alwaysGroup`
          // opt out, always keeping the group level visible as a dropdown.
          const leaf =
            !cat.alwaysGroup && values.length === 1
              ? { ...values[0], value: group }
              : undefined
          return { group, count, values, leaf }
        })
        // Keep expandable (multi-value) groups together above the collapsed
        // single-value leaves so chevron dropdowns and direct toggles don't
        // interleave; within each band, sort by count then name.
        .sort(
          (a, b) =>
            Number(!!a.leaf) - Number(!!b.leaf) ||
            b.count - a.count ||
            a.group.localeCompare(b.group)
        )
      return {
        label: cat.label,
        values: groups.flatMap((g) => g.values),
        groups,
      }
    }
    const counts = new Map<string, number>()
    for (const p of prepared) {
      const { value } = p.cats[i]
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    return {
      label: cat.label,
      values: sortFacetValues(counts, (value) =>
        leafKey(cat.label, undefined, value)
      ),
    }
  })
  return built.filter(
    (f) => !(f.values.length === 1 && f.values[0].value === "Unknown")
  )
}

// Effective deselections: the explicit ones, plus any value that — given those —
// no longer appears in a surviving connection (every connection carrying it also
// carried an explicitly-deselected value). Derived rather than stored, so the
// cascade reverses automatically when the causing value is reselected.
export function computeEffectiveDeselected(
  prepared: PreparedRow[],
  deselected: Set<string>
): Set<string> {
  const result = new Set(deselected)
  const reachable = new Set<string>()
  for (const p of prepared) {
    if (p.cats.some((c) => deselected.has(c.key))) continue
    for (const c of p.cats) reachable.add(c.key)
  }
  for (const p of prepared) {
    for (const c of p.cats) if (!reachable.has(c.key)) result.add(c.key)
  }
  return result
}

// Group connections by exact coordinate, dropping rows deselected in any
// category or lacking coordinates. Feeds the map's clustered source.
export function buildGroups(
  prepared: PreparedRow[],
  deselected: Set<string>
): LocationGroup[] {
  const byKey = new Map<string, LocationGroup>()
  for (const p of prepared) {
    if (p.cats.some((c) => deselected.has(c.key))) continue
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue
    const key = `${p.lat},${p.lng}`
    let group = byKey.get(key)
    if (!group) {
      group = {
        key,
        lat: p.lat,
        lng: p.lng,
        ip: p.row.ipAddress,
        country: p.data?.country,
        provider: text(p.data?.provider),
        organisation: p.data?.organisation,
        type: connectionType(p.data),
        data: p.data,
        threat: p.threat,
        connections: [],
      }
      byKey.set(key, group)
    }
    group.connections.push({ row: p.row, user: p.user })
  }
  return [...byKey.values()]
}

// The rows passing every category filter, independent of whether they resolved
// to coordinates. Reported upward for the share feature.
export function passingRows(
  prepared: PreparedRow[],
  effectiveDeselected: Set<string>
): SignIn[] {
  return prepared
    .filter((p) => !p.cats.some((c) => effectiveDeselected.has(c.key)))
    .map((p) => p.row)
}

// How many of `values` remain selected (not deselected).
export function selectedCount(
  values: FacetValue[],
  deselected: Set<string>
): number {
  return values.filter(({ key }) => !deselected.has(key)).length
}

// Counts per user within a group, ordered by descending count.
export function userCounts(group: LocationGroup): [string, number][] {
  const counts = new Map<string, number>()
  for (const c of group.connections) {
    counts.set(c.user, (counts.get(c.user) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

// Connections grouped by user; within each user, sorted most recent first.
export function connectionsByUser(
  group: LocationGroup,
  timestampOf: (row: SignIn) => number
): [string, Connection[]][] {
  const byUser = new Map<string, Connection[]>()
  for (const c of group.connections) {
    const list = byUser.get(c.user)
    if (list) list.push(c)
    else byUser.set(c.user, [c])
  }
  for (const list of byUser.values()) {
    list.sort((a, b) => timestampOf(b.row) - timestampOf(a.row))
  }
  return [...byUser.entries()].sort((a, b) => b[1].length - a[1].length)
}

// Distinct users for the Users panel: keyed by the colour/grouping label,
// carrying a display name and email, sorted alphabetically by name.
export function buildUsers(rows: SignIn[]): UserEntry[] {
  const byLabel = new Map<string, UserEntry>()
  for (const row of rows) {
    const label = userLabel(row)
    if (byLabel.has(label)) continue
    byLabel.set(label, {
      label,
      name: row.userDisplayName || row.userPrincipalName || "Unknown",
      email: row.userPrincipalName || "",
    })
  }
  return [...byLabel.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// Deterministic colour per distinct user, evenly spaced around the hue wheel so
// even a large set of users stays distinguishable on the map and in Analysis.
export function buildPalette(users: string[]): (user: string) => string {
  const palette = new Map<string, string>()
  users.forEach((user, i) => {
    const hue = Math.round((i * 360) / Math.max(users.length, 1))
    palette.set(user, `hsl(${hue} 70% 50%)`)
  })
  return (user: string) => palette.get(user) ?? "hsl(0 0% 60%)"
}

// Whether a row resolved to usable map coordinates through its enrichment.
function hasLocation(row: SignIn, enrichment: EnrichmentMap): boolean {
  const data = row.ipAddress ? enrichment[row.ipAddress] : undefined
  return (
    Number.isFinite(toNumber(data?.latitude)) &&
    Number.isFinite(toNumber(data?.longitude))
  )
}

// Whether any row resolved to coordinates at all, ignoring filters.
export function hasAnyLocation(
  rows: SignIn[],
  enrichment: EnrichmentMap
): boolean {
  return rows.some((row) => hasLocation(row, enrichment))
}

// How many of `rows` could not be placed on the map (no IP, no enrichment, or
// enrichment without usable coordinates). Used to warn that the map is showing
// fewer connections than the dataset holds.
export function countWithoutLocation(
  rows: SignIn[],
  enrichment: EnrichmentMap
): number {
  return rows.reduce(
    (sum, row) => sum + (hasLocation(row, enrichment) ? 0 : 1),
    0
  )
}
