import { ipInfo } from "@/lib/ip-lookup"
import type { IpInfo } from "@/lib/ip-lookup"
import type { LogRow } from "@/lib/entra-logs"

/** The columns that come from ProxyCheck rather than off the record, and what each
one reads off a lookup. One list, because the table mounts a column per entry
and the search reads the same values through it: a column nobody can search for
is a column half there. */
export const ipFields = [
  ["Detections", (info) => info.detections.map((one) => one.label).join(", ")],
  [
    "Provider",
    // One operator answers for every detection on an address, so the same name
    // sits on each of them and the column prints it once.
    (info) =>
      [...new Set(info.detections.map((one) => one.detail))]
        .filter((detail) => detail !== "")
        .join(" · "),
  ],
  ["ASN", (info) => info.asn],
  ["Type", (info) => info.type],
  ["Company", (info) => info.company],
  ["Coordinates", (info) => info.coordinates],
] as const satisfies ReadonlyArray<readonly [string, (info: IpInfo) => string]>

/** The name of one of them. Anything that names a column takes this, so a
label that is not one of these stops compiling rather than reading as a column
nobody filled in. */
export type IpColumn = (typeof ipFields)[number][0]

export const ipColumns: Array<IpColumn> = ipFields.map(([label]) => label)

// A field name off the search box is any string, so this side stays wide.
const isEnrichment = new Set<string>(ipColumns)

export const isIpColumn = (label: string) => isEnrichment.has(label)

const readers = new Map<string, (info: IpInfo) => string>(ipFields)

/** How one enrichment column reads a lookup, for whatever draws that value
somewhere other than the table. A column named here is one of the six, so
there is always a reader behind it. */
export const ipRead = (column: IpColumn) =>
  readers.get(column) as (info: IpInfo) => string

/** What one enrichment column says about a row. Empty while the lookup is out,
which is what an address nobody has asked about reads as too. */
export function ipValue(row: LogRow, label: string): string {
  const read = readers.get(label)
  if (read === undefined) return ""
  const info = ipInfo(row["IP Address"])
  return info === undefined ? "" : read(info)
}

/** Every enrichment column of a row as one lowercased string, for the same
reason the record's own columns have one: an unfielded term is one `includes`
rather than six.

Kept against the lookup rather than the row, so it is built once per address
however many records came from it, and a later result gets a new one instead of
the stale one a row-keyed cache would hold onto. */
const haystacks = new WeakMap<IpInfo, string>()
export function ipHaystack(row: LogRow): string {
  const info = ipInfo(row["IP Address"])
  if (info === undefined) return ""
  let text = haystacks.get(info)
  if (text === undefined) {
    text = ipFields
      .map(([, read]) => read(info))
      .join("\n")
      .toLowerCase()
    haystacks.set(info, text)
  }
  return text
}
