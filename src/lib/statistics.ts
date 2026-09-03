import { userOf } from "@/lib/connection-points"
import type { FacetValue } from "@/lib/facets"
import type { LogRow } from "@/lib/entra-logs"

/** One day's records under one status, the day being the reader's own. A day
with successes and failures is two of these, which is what stacks the bar. */
export type Day = { day: string; status: string; count: number }

/** The same split by the hour of the day it happened, in the same timezone the
days are counted in: three in the morning is only three in the morning where
the reader is. */
export type Hour = { hour: string; status: string; count: number }

/** What the records on screen add up to. */
export type Summary = {
  users: number
  addresses: number
  failures: number
  first: string
  last: string
  days: Array<Day>
  hours: Array<Hour>
}

const pad = (part: number) => String(part).padStart(2, "0")

/** The day an instant fell on where the reader is, rather than the day the ISO
string names in UTC. Both charts count the same records into the same day, so
they have to agree about when a day starts. */
const dayOf = (when: Date) =>
  `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`

/** The headline counts, the per-day split and the per-hour one, in one pass
over the rows. */
export function summarise(rows: Array<LogRow>): Summary {
  const days = new Map<string, Day>()
  const hours = new Map<string, number>()
  const statuses = new Set<string>()
  const users = new Set<string>()
  const addresses = new Set<string>()
  let failures = 0
  let first = ""
  let last = ""
  for (const row of rows) {
    users.add(userOf(row))
    if (row["IP Address"] !== "") addresses.add(row["IP Address"])
    if (row.Status === "Failure") failures += 1
    const when = new Date(row.Date)
    // A record whose date will not parse cannot be counted into a day or an
    // hour, and counting it into one but not the other is what made the two
    // charts disagree.
    if (Number.isNaN(when.getTime())) continue
    if (first === "" || row.Date < first) first = row.Date
    if (row.Date > last) last = row.Date
    const status = row.Status || "Unknown"
    statuses.add(status)
    const day = dayOf(when)
    const key = `${day} ${status}`
    const seen = days.get(key)
    if (seen === undefined) days.set(key, { day, status, count: 1 })
    else seen.count += 1
    const hour = `${pad(when.getHours())} ${status}`
    hours.set(hour, (hours.get(hour) ?? 0) + 1)
  }
  return {
    users: users.size,
    addresses: addresses.size,
    failures,
    first,
    last,
    // Oldest first, and a failure bar always on the same side of its day.
    days: [...days.values()].sort(
      (a, b) => a.day.localeCompare(b.day) || a.status.localeCompare(b.status)
    ),
    hours: hoursOf(hours, [...statuses].sort()),
  }
}

/** Every hour of the day, quiet ones included: a gap at four in the morning is
worth as much as a spike at nine, and dropping it would slide the rest along. */
const hoursOf = (counts: Map<string, number>, statuses: Array<string>) =>
  statuses.length === 0
    ? []
    : Array.from({ length: 24 }, (_, hour) =>
        statuses.map((status) => ({
          hour: pad(hour),
          status,
          count: counts.get(`${pad(hour)} ${status}`) ?? 0,
        }))
      ).flat()

/** One bar in a category's breakdown: what it is, how many records had it, and
its share of the category. */
export type Slice = {
  value: string
  count: number
  share: number
  /** Set on the last slice when it stands for everything past the cut. */
  rest?: number
}

/** A category's commonest values. What is left over is added up into one last
slice, so the bars still account for the whole category rather than trailing
off into a footnote. */
export function topValues(
  values: Array<FacetValue>,
  limit: number
): Array<Slice> {
  const all = values.reduce((sum, one) => sum + one.count, 0)
  const share = (count: number) => (all === 0 ? 0 : count / all)
  const top = values.slice(0, limit).map(({ value, count }) => ({
    value,
    count,
    share: share(count),
  }))
  const rest = values.slice(limit)
  if (rest.length === 0) return top
  const count = rest.reduce((sum, one) => sum + one.count, 0)
  return [
    ...top,
    {
      value: `${rest.length} more`,
      count,
      share: share(count),
      rest: rest.length,
    },
  ]
}
