import { ipInfo, placeOf } from "@/lib/ip-lookup"
import type { Locate, Place } from "@/lib/ip-lookup"
import { userOf } from "@/lib/connection-points"
import { sessionsFrom } from "@/lib/sessions"
import type { LogRow } from "@/lib/entra-logs"

/** What sort of thing a finding is. The picture beside a finding and the
filter over the list both read this rather than the title, so a title stays a
sentence that can be reworded. */
export type FindingKind =
  | "spray"
  | "network"
  | "travel"
  | "guessed"
  | "shared-session"
  | "roaming-session"
  | "audit"

/** One thing worth a second look, and the records it was read off. `high` is
something an analyst should explain before closing the case; `medium` is worth
knowing about the dataset. */
export type Finding = {
  id: string
  kind: FindingKind
  level: "high" | "medium"
  title: string
  subject: string
  detail: string
  /** The search that pulls the records back up, so the map can be filtered
  down to what the finding is about. */
  query: string
  rows: Array<LogRow>
}

/** `1 finding`, `2 findings`, `2 addresses`. */
export const many = (n: number, word: string) =>
  `${n.toLocaleString()} ${word}${n === 1 ? "" : /(s|x|ch|sh)$/.test(word) ? "es" : "s"}`

/** Kilometres between two places, over a sphere. */
const apart = (a: Place, b: Place) => {
  const rad = Math.PI / 180
  const half =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) *
      Math.cos(b.lat * rad) *
      Math.sin(((b.lon - a.lon) * rad) / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(half))
}

/** Two places this far apart, reached this fast, is a trip nobody made. Cheap
airliners cruise at 900km/h, so anything above that had help.
The floor keeps the neighbouring cities a mobile network hops between out of it.

ponytail: a naive heuristic on geolocation that is a city at best. It catches
the case worth catching, a session used from two continents at once, and will
say nothing about a proxy two towns over. */
const tooFast = 900
const farEnough = 500

/** Failures in a row before it reads as someone working through a list rather
than someone mistyping. */
const burst = 5

/** How many accounts one address has to fail against before it is a sweep. */
const sprayed = 5

/** Audit activities worth reading whatever else the dataset holds: the ones
that hand out access or change how it is proved. */
const privileged =
  /role|group|member|password|credential|policy|permission|owner|licen[cs]e|consent/i

const byDate = (a: LogRow, b: LogRow) => (a.Date < b.Date ? -1 : 1)

/** A value as a search term. Quoted, so an address is one term rather than four
and a display name keeps its spaces. With no field in front of it a term matches
any column, which is how an account is looked for: half of them are filed under
an email and the rest under a name. */
const term = (value: string) => `"${value.replace(/["\\]/g, "\\$&")}"`
export const field = (name: string, value: string) => `${name}:${term(value)}`

/** The records themselves as a search, for a finding that is about a couple of
them rather than about everything an address or an account did. */
const records = (rows: Array<LogRow>) =>
  `recordId:(${rows.map((row) => term(row["Record ID"])).join(" OR ")})`

/** The account a record is filed under, as a search. `userOf` reads the email
and falls back to the display name, so this names the column the account came
off rather than looking for it loose: an address that turns up in someone
else's record is not a connection of theirs. */
const account = (row: LogRow) =>
  row.Email === ""
    ? field("name", row.Name || "Unknown")
    : field("email", row.Email)

/** What stands out in the loaded records. Everything here is read off the rows
and what ProxyCheck said about their addresses, so it re-runs as lookups land. */
export function findings(
  rows: Array<LogRow>,
  locate: Locate = ipInfo
): Array<Finding> {
  const found: Array<Finding> = []
  const addresses = Map.groupBy(
    rows.filter((row) => row["IP Address"] !== ""),
    (row) => row["IP Address"]
  )

  for (const [ip, group] of addresses) {
    const failures = group.filter((row) => row.Status === "Failure")
    const failed = new Set(failures.map(userOf))
    if (failed.size >= sprayed) {
      found.push({
        id: `spray:${ip}`,
        kind: "spray",
        level: "high",
        title: "One address, many accounts",
        subject: ip,
        // The failures, not everything the address did: a sweep is worth
        // looking at without the accounts it did not miss.
        query: `${field("ipAddress", ip)} ${field("status", "Failure")}`,
        detail: `${many(failures.length, "failure")} against ${many(failed.size, "account")}`,
        rows: failures,
      })
    }

    const labels = (locate(ip)?.detections ?? []).map((one) => one.label)
    if (labels.length === 0) continue
    const users = new Set(group.map(userOf))
    found.push({
      id: `network:${ip}`,
      kind: "network",
      // Hosting on its own is a datacentre, which is half the internet. The
      // rest are someone standing between the user and Entra on purpose.
      level: labels.every((label) => label === "Hosting" || label === "Relay")
        ? "medium"
        : "high",
      title: "Anonymised network",
      subject: ip,
      query: field("ipAddress", ip),
      detail: `${labels.join(", ")} · ${many(group.length, "record")} from ${many(users.size, "user")}`,
      rows: group,
    })
  }

  for (const [user, group] of Map.groupBy(rows, userOf)) {
    const stops = group
      // Only the sign-ins that worked. A failure says an address tried the
      // account, not that the account was ever there, and an audit record
      // carries no address of its own to be anywhere from.
      .filter((row) => row.Status === "Success")
      .map((row) => ({
        row,
        at: Date.parse(row.Date),
        place: placeOf(locate(row["IP Address"])),
      }))
      .filter(
        (stop): stop is { row: LogRow; at: number; place: Place } =>
          stop.place !== undefined && !Number.isNaN(stop.at)
      )
      .sort((a, b) => a.at - b.at)

    // The fastest hop only. One line per user beats one per pair of records,
    // and the fastest is the one that takes the most explaining.
    let worst: { km: number; speed: number; rows: Array<LogRow> } | undefined
    for (let at = 1; at < stops.length; at++) {
      const [from, to] = [stops[at - 1], stops[at]]
      const km = apart(from.place, to.place)
      if (km < farEnough) continue
      // Two records in the same minute are one moment, not an instant trip.
      const hours = Math.max((to.at - from.at) / 3_600_000, 1 / 60)
      const speed = km / hours
      if (speed < tooFast) continue
      if (worst === undefined || speed > worst.speed) {
        worst = { km, speed, rows: [from.row, to.row] }
      }
    }
    if (worst !== undefined) {
      found.push({
        id: `travel:${user}`,
        kind: "travel",
        level: "high",
        title: "Impossible travel",
        subject: user,
        // The two records the hop was read off. Everything else the account did
        // is what it does, and none of it is the trip.
        query: records(worst.rows),
        detail: `${Math.round(worst.km).toLocaleString()} km apart, ${Math.round(worst.speed).toLocaleString()} km/h between two records`,
        rows: worst.rows,
      })
    }
  }

  for (const [, group] of Map.groupBy(
    rows.filter((row) => row.Status !== ""),
    (row) => `${userOf(row)} ${row["IP Address"]}`
  )) {
    const ordered = [...group].sort(byDate)
    let run = 0
    let failuresBeforeSuccess = 0
    for (const row of ordered) {
      if (row.Status === "Failure") {
        run += 1
        continue
      }
      if (row.Status !== "Success") continue
      if (run >= burst) {
        failuresBeforeSuccess = run
        break
      }
      run = 0
    }
    if (failuresBeforeSuccess === 0) continue
    const first = ordered[0]
    found.push({
      id: `guessed:${userOf(first)}:${first["IP Address"]}`,
      kind: "guessed",
      level: "high",
      title: "Failures, then a sign-in",
      // Two terms mean AND: this one is about an account and an address
      // together, not either of them on its own.
      query: [
        account(first),
        first["IP Address"] === ""
          ? ""
          : field("ipAddress", first["IP Address"]),
      ]
        .filter((part) => part !== "")
        .join(" "),
      subject: `${userOf(first)} from ${first["IP Address"] || "an unknown address"}`,
      detail: `${many(failuresBeforeSuccess, "failure")} in a row, then a success`,
      rows: ordered,
    })
  }

  for (const session of sessionsFrom(rows)) {
    if (session.addresses.length < 2 && session.users.length < 2) continue
    const lookups = session.addresses.map((ip) => locate(ip))
    const networks = new Set(
      lookups.map((info) => info?.asn ?? "").filter((asn) => asn !== "")
    )
    // The two addresses furthest apart, over a handful of them.
    const places = lookups
      .map(placeOf)
      .filter((place): place is Place => place !== undefined)
    let spread = 0
    for (const from of places) {
      for (const to of places) spread = Math.max(spread, apart(from, to))
    }
    const shared = session.users.length > 1
    // A phone stepping between two addresses of one operator is a session
    // doing what sessions do. Two operators, or half a continent, is not.
    if (!shared && spread < farEnough && networks.size < 2) continue
    found.push({
      id: `session:${session.id}`,
      kind: shared ? "shared-session" : "roaming-session",
      level: shared || spread >= farEnough ? "high" : "medium",
      title: shared
        ? "One session, two accounts"
        : "Session used from several addresses",
      query: field("sessionId", session.id),
      subject: `${session.users.join(", ")} · ${session.id}`,
      detail: [
        many(session.addresses.length, "address"),
        networks.size > 1 ? many(networks.size, "network") : "",
        spread >= 1 ? `${Math.round(spread).toLocaleString()} km apart` : "",
        many(session.rows.length, "record"),
      ]
        .filter((part) => part !== "")
        .join(" · "),
      rows: session.rows,
    })
  }

  for (const [activity, group] of Map.groupBy(
    rows.filter((row) => row.Activity !== "" && privileged.test(row.Activity)),
    (row) => row.Activity
  )) {
    found.push({
      id: `audit:${activity}`,
      kind: "audit",
      level: "medium",
      title: "Access changed",
      subject: activity,
      query: field("activity", activity),
      detail: `${many(group.length, "record")} by ${many(new Set(group.map(userOf)).size, "user")}`,
      rows: group,
    })
  }

  return found.sort(
    (a, b) =>
      (a.level === b.level ? 0 : a.level === "high" ? -1 : 1) ||
      b.rows.length - a.rows.length ||
      a.subject.localeCompare(b.subject)
  )
}
