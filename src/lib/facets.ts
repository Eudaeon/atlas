import { ipInfo } from "@/lib/ip-lookup"
import type { IpInfo, Locate } from "@/lib/ip-lookup"
import { ipRead } from "@/lib/ip-columns"
import type { IpColumn } from "@/lib/ip-columns"
import type { LogRow } from "@/lib/entra-logs"

/** A category that reads the same value its table column does, under whatever
name the panel gives it, so the two can never drift apart. */
const fromLookup = (column: IpColumn) => {
  const read = ipRead(column)
  return (_row: LogRow, info: IpInfo | undefined) =>
    info === undefined ? "" : read(info)
}

const detections = fromLookup("Detections")

// What the map's Categories panel filters by. Each one reads a single value off
// a record, or off what ProxyCheck said about its address. Order is the panel's.
const categories: Array<{
  label: string
  read: (row: LogRow, info: IpInfo | undefined) => string
}> = [
  { label: "IP", read: (row) => row["IP Address"] },
  { label: "Status", read: (row) => row.Status },
  {
    label: "Authentication Requirement",
    read: (row) => row["Authentication Requirement"],
  },
  { label: "Conditional Access", read: (row) => row["Conditional Access"] },
  { label: "Application", read: (row) => row.Application },
  { label: "Resource", read: (row) => row.Resource },
  { label: "Device", read: (row) => row.Device },
  { label: "OS", read: (row) => row.OS },
  { label: "Client", read: (row) => row.Client },
  { label: "Browser", read: (row) => row.Browser },
  {
    label: "Detections",
    // An address that was looked up and came back clean says so, rather than
    // reading as one nobody has asked about yet.
    read: (row, info) =>
      info === undefined ? "" : detections(row, info) || "None",
  },
  { label: "Provider", read: fromLookup("Provider") },
  { label: "Network", read: fromLookup("ASN") },
  { label: "Type", read: fromLookup("Type") },
  { label: "Company", read: fromLookup("Company") },
]

/** A record with its lookup and its category values read once. Everything the
panel and the map need comes out of this one pass. */
export type Prepared = {
  row: LogRow
  info: IpInfo | undefined
  /** Index-aligned with the categories. */
  values: Array<string>
  /** The same values as switch keys, kept rather than rebuilt: every category
  toggle walks all of them, and an upload is a few hundred thousand records. */
  keys: Array<string>
}

export type FacetValue = { key: string; value: string; count: number }
export type Facet = { label: string; values: Array<FacetValue> }

/** What a value is switched off under. Carries the category, so the same word
under two categories stays two separate toggles. */
export const facetKey = (label: string, value: string) => `${label}::${value}`

export function prepare(
  rows: Array<LogRow>,
  locate: Locate = ipInfo
): Array<Prepared> {
  return rows.map((row) => {
    const found = locate(row["IP Address"])
    // A lookup that failed knows nothing, so its categories read the same as an
    // address nobody has asked about yet. Otherwise every failure counts itself
    // under "None" detections and a clean run looks like a quiet one.
    const info = found?.error === undefined ? found : undefined
    const values = categories.map(
      (category) => category.read(row, info) || "Unknown"
    )
    return {
      row,
      info,
      values,
      keys: categories.map((category, at) =>
        facetKey(category.label, values[at])
      ),
    }
  })
}

/** Every category with the values actually present, "Unknown" first and the
commonest of the rest after it. A category
nobody filled in is dropped rather than shown as a lone Unknown, and one with
nothing under it at all is dropped too: with no records on screen that is every
category, which is what takes the panel off the map. */
export function buildFacets(prepared: Array<Prepared>): Array<Facet> {
  return categories
    .map((category, at) => {
      const counts = new Map<string, number>()
      for (const one of prepared) {
        const value = one.values[at]
        counts.set(value, (counts.get(value) ?? 0) + 1)
      }
      return {
        label: category.label,
        values: [...counts]
          .map(([value, count]) => ({
            key: facetKey(category.label, value),
            value,
            count,
          }))
          // "Unknown" leads whatever it counts. It is the pile you check
          // first, not one of the answers.
          .sort(
            (a, b) =>
              Number(b.value === "Unknown") - Number(a.value === "Unknown") ||
              b.count - a.count ||
              a.value.localeCompare(b.value)
          ),
      }
    })
    .filter(
      (facet) =>
        facet.values.length > 0 &&
        !(facet.values.length === 1 && facet.values[0].value === "Unknown")
    )
}

/** The values switched off, plus the ones that switching those off left with no
connection to belong to. Worked out rather than stored, so switching a value
back on brings its followers with it. */
export function spreadDeselected(
  prepared: Array<Prepared>,
  deselected: ReadonlySet<string>
): Set<string> {
  const spread = new Set(deselected)
  const alive = new Set<string>()
  for (const one of prepared) {
    if (one.keys.some((key) => deselected.has(key))) continue
    for (const key of one.keys) alive.add(key)
  }
  for (const one of prepared) {
    for (const key of one.keys) if (!alive.has(key)) spread.add(key)
  }
  return spread
}

/** The records left once every switched-off value is taken out. */
export const passing = (
  prepared: Array<Prepared>,
  deselected: ReadonlySet<string>
): Array<LogRow> =>
  prepared
    .filter((one) => !one.keys.some((key) => deselected.has(key)))
    .map((one) => one.row)

export const selectedCount = (
  values: Array<FacetValue>,
  deselected: ReadonlySet<string>
) => values.filter((one) => !deselected.has(one.key)).length
