// Aggregates a loaded sign-in set into chart-ready series for the Statistics
// view. Everything here is pure: each function turns the rows (and, where
// relevant, their IP enrichment) into plain arrays the Recharts components
// render directly. Enrichment-derived series come back empty when no IP has
// been looked up, and the view skips those cards.

import { type SignIn, userLabel } from "@/lib/signin"
import { connectionType, type EnrichmentMap } from "@/lib/proxycheck"
import { reputationLevel, type CrowdSecMap } from "@/lib/crowdsec"
import { authRequirement, browserFacet, osFacet } from "@/lib/format"

export type NamedCount = { name: string; count: number }

// A point on the activity timeline: a bucket of time with its success/failure
// split. `label` is the human axis tick; `key` keeps buckets ordered.
export type TimePoint = {
  key: number
  label: string
  success: number
  failure: number
}

export type Statistics = {
  timeline: TimePoint[]
  hourOfDay: NamedCount[]
  dayOfWeek: NamedCount[]
  outcome: NamedCount[]
  auth: NamedCount[]
  failureReasons: NamedCount[]
  topUsers: NamedCount[]
  topApps: NamedCount[]
  clientApps: NamedCount[]
  browsers: NamedCount[]
  operatingSystems: NamedCount[]
  topIps: NamedCount[]
  topCountries: NamedCount[]
  topProviders: NamedCount[]
  connectionTypes: NamedCount[]
  riskBands: NamedCount[]
}

function isSuccess(row: SignIn): boolean {
  return row.status?.errorCode === 0
}

const DAY_MS = 86_400_000

// Count occurrences of each key the accessor returns, sorted highest-first and
// capped to `limit`. By default rows whose key is empty are skipped; when
// `includeUnknown` is set they're bucketed under "Unknown" instead, so the chart
// accounts for every row rather than silently dropping ones with a missing value.
// When `bucketOther` is set and there are more than `limit` categories,
// everything from the limit-th value onward is collapsed into a single "Other"
// entry instead of being dropped, so the result still sums to the whole (needed
// for pie charts, where dropping slices would distort the proportions).
function tally(
  rows: SignIn[],
  keyOf: (row: SignIn) => string | undefined,
  limit = 8,
  bucketOther = false,
  includeUnknown = false
): NamedCount[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = keyOf(row) || (includeUnknown ? "Unknown" : undefined)
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const sorted = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  if (!bucketOther || sorted.length <= limit) return sorted.slice(0, limit)

  const top = sorted.slice(0, limit - 1)
  const otherCount = sorted
    .slice(limit - 1)
    .reduce((sum, d) => sum + d.count, 0)
  return [...top, { name: "Other", count: otherCount }]
}

// The bucket boundary a date falls in, by granularity.
function bucketStart(d: Date, unit: "hour" | "day" | "month"): Date {
  if (unit === "hour")
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours())
  if (unit === "day")
    return new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function advance(d: Date, unit: "hour" | "day" | "month"): Date {
  const next = new Date(d)
  if (unit === "hour") next.setHours(next.getHours() + 1)
  else if (unit === "day") next.setDate(next.getDate() + 1)
  else next.setMonth(next.getMonth() + 1)
  return next
}

function labelFor(d: Date, unit: "hour" | "day" | "month"): string {
  if (unit === "hour")
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
    })
  if (unit === "day")
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" })
}

// Sign-ins bucketed over time, split success/failure. The granularity adapts to
// the span — hourly for a couple of days, daily up to a few months, monthly
// beyond — and empty buckets are filled so the line stays continuous.
function buildTimeline(rows: SignIn[]): TimePoint[] {
  const dated = rows
    .map((row) => ({
      row,
      time: row.createdDateTime ? new Date(row.createdDateTime) : null,
    }))
    .filter(
      (r): r is { row: SignIn; time: Date } =>
        !!r.time && !Number.isNaN(r.time.getTime())
    )
  if (dated.length === 0) return []

  const times = dated.map((d) => d.time.getTime())
  const min = Math.min(...times)
  const max = Math.max(...times)
  const spanDays = (max - min) / DAY_MS
  const unit: "hour" | "day" | "month" =
    spanDays <= 2 ? "hour" : spanDays <= 120 ? "day" : "month"

  // Pre-create every bucket from the first to the last so gaps render as zero.
  const buckets = new Map<number, TimePoint>()
  let cursor = bucketStart(new Date(min), unit)
  const end = bucketStart(new Date(max), unit).getTime()
  while (cursor.getTime() <= end) {
    buckets.set(cursor.getTime(), {
      key: cursor.getTime(),
      label: labelFor(cursor, unit),
      success: 0,
      failure: 0,
    })
    cursor = advance(cursor, unit)
  }

  for (const { row, time } of dated) {
    const point = buckets.get(bucketStart(time, unit).getTime())
    if (!point) continue
    if (isSuccess(row)) point.success++
    else point.failure++
  }
  return [...buckets.values()].sort((a, b) => a.key - b.key)
}

// Sign-ins grouped by local hour of day (00–23), every hour shown so the daily
// rhythm — and any off-hours spikes — reads at a glance.
function buildHourOfDay(rows: SignIn[]): NamedCount[] {
  const counts = new Array(24).fill(0)
  for (const row of rows) {
    if (!row.createdDateTime) continue
    const d = new Date(row.createdDateTime)
    if (Number.isNaN(d.getTime())) continue
    counts[d.getHours()]++
  }
  return counts.map((count, h) => ({ name: `${h}:00`, count }))
}

// Sign-ins grouped by local day of week, Monday first, weekday names localised.
function buildDayOfWeek(rows: SignIn[]): NamedCount[] {
  const counts = new Array(7).fill(0)
  for (const row of rows) {
    if (!row.createdDateTime) continue
    const d = new Date(row.createdDateTime)
    if (Number.isNaN(d.getTime())) continue
    counts[d.getDay()]++
  }
  // Jan 1 2023 was a Sunday, so this reference week names each weekday.
  const name = (dow: number) =>
    new Date(2023, 0, 1 + dow).toLocaleDateString(undefined, {
      weekday: "short",
    })
  const order = [1, 2, 3, 4, 5, 6, 0]
  return order.map((dow) => ({ name: name(dow), count: counts[dow] }))
}

// Sign-ins bucketed by CrowdSec reputation verdict, ordered worst → benign, with
// "Unknown" kept last. Only rows whose IP CrowdSec returned data for are counted,
// so the card stays hidden until enrichment exists; among those, an IP CrowdSec
// has no verdict for still counts, under "Unknown", rather than being dropped.
// Empty bands drop.
function buildRiskBands(rows: SignIn[], crowdsec: CrowdSecMap): NamedCount[] {
  const order = ["Malicious", "Suspicious", "Known", "Safe", "Unknown"]
  const counts = new Map<string, number>(order.map((name) => [name, 0]))
  for (const row of rows) {
    const data = row.ipAddress ? crowdsec[row.ipAddress] : undefined
    if (!data) continue
    const label = reputationLevel(data).label
    if (counts.has(label)) counts.set(label, counts.get(label)! + 1)
  }
  return order
    .map((name) => ({ name, count: counts.get(name)! }))
    .filter((b) => b.count > 0)
}

export function computeStatistics(
  rows: SignIn[],
  enrichment: EnrichmentMap,
  crowdsec: CrowdSecMap
): Statistics {
  const failures = rows.filter((r) => !isSuccess(r)).length

  const authCounts = { Single: 0, Multi: 0, Other: 0 }
  for (const row of rows) {
    const label = authRequirement(row)
    if (label === "Single-factor") authCounts.Single++
    else if (label === "Multi-factor") authCounts.Multi++
    else authCounts.Other++
  }

  return {
    timeline: buildTimeline(rows),
    hourOfDay: buildHourOfDay(rows),
    dayOfWeek: buildDayOfWeek(rows),
    outcome: [
      { name: "Success", count: rows.length - failures },
      { name: "Failure", count: failures },
    ].filter((d) => d.count > 0),
    // When a source doesn't record the auth requirement at all (e.g. Purview
    // audit-log CSVs), every row falls into "Other"; a 100%-Other breakdown says
    // nothing, so drop it rather than show a single meaningless slice.
    auth:
      authCounts.Single + authCounts.Multi === 0
        ? []
        : [
            { name: "Single-factor", count: authCounts.Single },
            { name: "Multi-factor", count: authCounts.Multi },
            { name: "Other", count: authCounts.Other },
          ].filter((d) => d.count > 0),
    failureReasons: tally(
      rows.filter((r) => !isSuccess(r)),
      (r) => r.status?.failureReason,
      8,
      true,
      true
    ),
    topUsers: tally(rows, (r) => userLabel(r)),
    topApps: tally(rows, (r) => r.appDisplayName, 8, false, true),
    clientApps: tally(rows, (r) => r.clientAppUsed, 8, true, true),
    browsers: tally(
      rows,
      (r) => {
        const { group } = browserFacet(r)
        return group === "N/A" ? undefined : group
      },
      8,
      true
    ),
    operatingSystems: tally(rows, (r) => osFacet(r).group, 8, true),
    topIps: tally(rows, (r) => r.ipAddress, 8, false, true),
    // Enrichment-derived: a row whose IP wasn't looked up yields undefined (so
    // the card stays hidden until enrichment exists), but an IP that was looked
    // up and simply lacks the field counts as "Unknown".
    topCountries: tally(rows, (r) => {
      const data = r.ipAddress ? enrichment[r.ipAddress] : undefined
      return data ? (data.country ?? "Unknown") : undefined
    }),
    topProviders: tally(rows, (r) => {
      const data = r.ipAddress ? enrichment[r.ipAddress] : undefined
      return data ? (data.provider ?? "Unknown") : undefined
    }),
    connectionTypes: tally(
      rows,
      (r) => {
        const data = r.ipAddress ? enrichment[r.ipAddress] : undefined
        return data ? connectionType(data) || "Unknown" : undefined
      },
      8,
      true
    ),
    riskBands: buildRiskBands(rows, crowdsec),
  }
}
