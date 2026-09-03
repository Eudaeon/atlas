import { ipInfo, placeOf } from "@/lib/ip-lookup"
import type { IpInfo, Locate } from "@/lib/ip-lookup"
import type { LogRow } from "@/lib/entra-logs"

/** One user's connections from one address. */
export type Visitor = {
  user: string
  name: string
  count: number
  color: string
  rows: Array<LogRow>
}

/** Every connection that came from one address. */
export type Point = {
  id: string
  ip: string
  lon: number
  lat: number
  count: number
  info: IpInfo | undefined
  visitors: Array<Visitor>
}

// Colours are handed out in the order users turn up, walking the hue circle by
// the golden angle so that neighbours never land on the same colour.
//
// ponytail: a session-long map, so a user keeps its colour while the tab lives.
// Hash the name instead the day the colour has to survive a reload.
const colors = new Map<string, string>()

export function userColor(user: string) {
  let color = colors.get(user)
  if (color === undefined) {
    color = `hsl(${(colors.size * 137.508) % 360}, 65%, 55%)`
    colors.set(user, color)
  }
  return color
}

/** Who a record belongs to. The address is theirs, so everything on the map is
counted under this. */
export const userOf = (row: LogRow) => row.Email || row.Name || "Unknown"

/** Groups located records by the address they came from. One pass over the
rows: the map is rebuilt whenever a lookup lands, which is every second while a
run is on.

Records whose address has not been looked up yet, or has no coordinates, are
left out.

One marker per address rather than per place: separate addresses often land on
the same city centre, and merging them would file every connection under the
first address and its detections. Addresses sharing a spot are pushed apart on a
spiral instead, by tens of metres, well under how precisely any of this is
known. */
export function pointsFrom(
  rows: Array<LogRow>,
  locate: Locate = ipInfo
): Array<Point> {
  const points = new Map<string, Point>()
  const seats = new Map<string, Map<string, Visitor>>()
  // How many addresses already sit on each exact spot, for the push apart.
  const taken = new Map<string, number>()

  for (const row of rows) {
    const ip = row["IP Address"]
    const info = locate(ip)
    const place = info?.coordinates
    if (place === undefined || place === "") continue
    const id = `${ip}@${place}`

    let point = points.get(id)
    if (point === undefined) {
      const at = placeOf(info)
      if (at === undefined) continue
      const nth = taken.get(place) ?? 0
      taken.set(place, nth + 1)
      const angle = nth * 2.39996
      const away = nth === 0 ? 0 : 0.0003 * Math.sqrt(nth)
      point = {
        id,
        ip,
        lat: at.lat + away * Math.sin(angle),
        lon: at.lon + away * Math.cos(angle),
        count: 0,
        info,
        visitors: [],
      }
      points.set(id, point)
      seats.set(id, new Map())
    }

    point.count += 1

    const user = userOf(row)
    const here = seats.get(id)!
    const visitor = here.get(user)
    if (visitor === undefined) {
      here.set(user, {
        user,
        name: row.Name || user,
        count: 1,
        color: userColor(user),
        rows: [row],
      })
    } else {
      visitor.count += 1
      visitor.rows.push(row)
    }
  }

  for (const [id, here] of seats) {
    const visitors = [...here.values()].sort((a, b) => b.count - a.count)
    // Newest connection first: a marker is opened to see what this address did
    // last, and the records arrive in whatever order the files were written in.
    for (const visitor of visitors) {
      visitor.rows.sort((a, b) => Date.parse(b.Date) - Date.parse(a.Date))
    }
    points.get(id)!.visitors = visitors
  }

  return [...points.values()]
}
