import { userOf } from "@/lib/connection-points"
import type { LogRow } from "@/lib/entra-logs"

/** Every sign-in Entra filed under one session id: one signed-in session, with
whatever addresses, devices and applications it was used from. Audit records
carry no session id, so none of them are here. */
export type Session = {
  id: string
  /** Normally one. More than one account on a session id is worth a look. */
  users: Array<string>
  name: string
  first: string
  last: string
  addresses: Array<string>
  devices: Array<string>
  apps: Array<string>
  rows: Array<LogRow>
}

const unique = (values: Array<string>) =>
  [...new Set(values.filter((value) => value !== ""))].sort()

/** The sign-ins grouped by the session they belong to. Roaming sessions first,
then the most recent, because a session used from two addresses is the one
worth opening. */
export function sessionsFrom(rows: Array<LogRow>): Array<Session> {
  const grouped = Map.groupBy(
    rows.filter((row) => row["Session ID"] !== ""),
    (row) => row["Session ID"]
  )

  return [...grouped]
    .map(([id, group]) => {
      const dates = group.map((row) => row.Date).filter((date) => date !== "")
      return {
        id,
        users: unique(group.map(userOf)),
        name: group.find((row) => row.Name !== "")?.Name ?? "",
        first:
          dates.length === 0 ? "" : dates.reduce((a, b) => (a < b ? a : b)),
        last: dates.length === 0 ? "" : dates.reduce((a, b) => (a > b ? a : b)),
        addresses: unique(group.map((row) => row["IP Address"])),
        devices: unique(group.map((row) => row.Device || row.OS)),
        apps: unique(group.map((row) => row.Application)),
        rows: [...group].sort((a, b) => (a.Date < b.Date ? -1 : 1)),
      }
    })
    .sort(
      (a, b) =>
        Number(b.addresses.length > 1) - Number(a.addresses.length > 1) ||
        (a.last < b.last ? 1 : -1)
    )
}
