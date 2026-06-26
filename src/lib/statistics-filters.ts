// The filter model behind the Statistics view. Pure: turns the loaded rows into
// the selectable filter values and applies a chosen filter set to produce the
// subset every chart is then computed from.

import { userLabel, type SignIn } from "@/lib/signin"
import type { EnrichmentMap } from "@/lib/proxycheck"
import { text } from "@/lib/format"

// "all" means unfiltered. Outcome is derived from the sign-in status; user, app
// and country each pick a single value present in the data.
export type StatFilters = {
  outcome: "all" | "success" | "failure"
  user: string
  app: string
  country: string
}

export const NO_FILTERS: StatFilters = {
  outcome: "all",
  user: "all",
  app: "all",
  country: "all",
}

export type Option = { value: string; label: string }

// The selectable values for the user/app/country filters, each derived from the
// loaded rows (so a value can always be matched back to at least one row) and
// ordered alphabetically. Countries come from IP enrichment, so the list is
// empty until lookups exist and the view hides that filter.
export type FilterOptions = {
  users: Option[]
  apps: Option[]
  countries: Option[]
}

// The app name as used for both the option list and matching: a missing name is
// bucketed under "Unknown", mirroring how the charts tally applications.
function appOf(row: SignIn): string {
  return text(row.appDisplayName)
}

// The country for a row, or undefined when its IP was never looked up (so
// un-enriched rows don't create a spurious "Unknown" country option).
function countryOf(row: SignIn, enrichment: EnrichmentMap): string | undefined {
  const data = row.ipAddress ? enrichment[row.ipAddress] : undefined
  return data ? (data.country ?? "Unknown") : undefined
}

function isSuccess(row: SignIn): boolean {
  return row.status?.errorCode === 0
}

// Distinct values an accessor returns across the rows, sorted alphabetically
// (numeric-aware so e.g. "10" follows "2"), as {value,label} options.
function distinct(
  rows: SignIn[],
  keyOf: (row: SignIn) => string | undefined
): Option[] {
  const values = new Set<string>()
  for (const row of rows) {
    const key = keyOf(row)
    if (key) values.add(key)
  }
  return [...values]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((value) => ({ value, label: value }))
}

export function buildFilterOptions(
  rows: SignIn[],
  enrichment: EnrichmentMap
): FilterOptions {
  return {
    users: distinct(rows, userLabel),
    apps: distinct(rows, appOf),
    countries: distinct(rows, (row) => countryOf(row, enrichment)),
  }
}

// The rows passing the filters. Returns the same array when nothing is selected
// so the common (unfiltered) case skips the work and keeps a stable reference.
export function filterRows(
  rows: SignIn[],
  enrichment: EnrichmentMap,
  filters: StatFilters
): SignIn[] {
  if (
    filters.outcome === "all" &&
    filters.user === "all" &&
    filters.app === "all" &&
    filters.country === "all"
  ) {
    return rows
  }
  return rows.filter((row) => {
    if (filters.outcome === "success" && !isSuccess(row)) return false
    if (filters.outcome === "failure" && isSuccess(row)) return false
    if (filters.user !== "all" && userLabel(row) !== filters.user) return false
    if (filters.app !== "all" && appOf(row) !== filters.app) return false
    if (
      filters.country !== "all" &&
      countryOf(row, enrichment) !== filters.country
    )
      return false
    return true
  })
}
