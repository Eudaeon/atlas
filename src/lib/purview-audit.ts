type Raw = Record<string, any>

const text = (value: unknown) => String(value ?? "")

const QUOTE = 34
const COMMA = 44
const LF = 10
const CR = 13

/** A CSV split into rows of fields. A quoted field keeps its commas and line
breaks, and a doubled quote inside one is a single quote. Written against what
Purview exports rather than as a general reader: every record it writes is one
line, because the JSON it carries has its own line breaks escaped.

ponytail: a parser rather than a package, because this is the whole of CSV that
one export uses, and the alternative is a dependency for thirty lines. */
export function parseCsv(source: string): Array<Array<string>> {
  const rows: Array<Array<string>> = []
  let row: Array<string> = []
  let at = 0
  while (at < source.length) {
    if (source.charCodeAt(at) === QUOTE) {
      at += 1
      // The closing quote is the first one not doubled. Found by jumping
      // between quotes rather than walking the field, so a 2KB audit record
      // costs a handful of steps instead of two thousand.
      let end = at
      for (;;) {
        const close = source.indexOf('"', end)
        if (close === -1) {
          end = source.length
          break
        }
        if (source.charCodeAt(close + 1) === QUOTE) {
          end = close + 2
          continue
        }
        end = close
        break
      }
      const field = source.slice(at, end)
      row.push(field.includes('""') ? field.replaceAll('""', '"') : field)
      at = end + 1
    } else {
      let end = at
      while (end < source.length) {
        const char = source.charCodeAt(end)
        if (char === COMMA || char === LF || char === CR) break
        end += 1
      }
      row.push(source.slice(at, end))
      at = end
    }

    const ended = source.charCodeAt(at)
    if (ended === COMMA) {
      at += 1
      continue
    }
    rows.push(row)
    row = []
    if (ended === CR) at += 1
    if (source.charCodeAt(at) === LF) at += 1
  }
  if (row.length > 0) rows.push(row)
  return rows
}

/** The operations worth putting on a map: the ones that carry an address and
say where an account was used from. Purview writes the same export whatever was
asked of it, so Atlas reads these operations out of a file holding more and drops
the rest. */
export const operations = [
  "UserLoggedIn",
  "UserLoginFailed",
  "MailItemsAccessed",
  "MailboxLogin",
  "Send",
  "SendAs",
  "SendOnBehalf",
  "New-InboxRule",
  "Set-InboxRule",
  "UpdateInboxRules",
]

const wanted = new Set(operations)

/** Whether this is a Purview export rather than a Graph one. Read off the
header line alone: a Graph export is JSON, so nothing in the first line of one
looks like this, and sniffing beats scanning 150MB to find out. */
export function isPurviewExport(source: string) {
  const ends = source.indexOf("\n")
  const header = ends === -1 ? source.slice(0, 400) : source.slice(0, ends)
  return header.includes("AuditData") && header.includes("Operation")
}

/** The rows of a Purview export, of the operations Atlas reads, each one still
holding its audit record as the JSON string it arrived as. Parsing that JSON is
the expensive half and it is left to `purviewRecord`, so it happens a slice at a
time under the loader rather than all at once before it. */
export function purviewRecords(source: string): Array<Raw> {
  const rows = parseCsv(source)
  if (rows.length === 0) throw new Error("The file is empty.")
  const header = rows[0]
  const dateAt = header.indexOf("CreationDate")
  const operationAt = header.indexOf("Operation")
  const dataAt = header.indexOf("AuditData")
  if (dateAt === -1 || operationAt === -1 || dataAt === -1) {
    throw new Error("Expected CreationDate, Operation and AuditData columns.")
  }
  const records: Array<Raw> = []
  for (let at = 1; at < rows.length; at += 1) {
    const row = rows[at]
    if (row.length <= dataAt) continue
    if (!wanted.has(row[operationAt])) continue
    records.push({ CreationDate: row[dateAt], AuditData: row[dataAt] })
  }
  return records
}

/** One row read into the record its columns describe. The audit record holds
its own `CreationTime`, and that one is written without a zone, so `Date.parse`
reads it as local and an export lands hours from where it happened. The column
beside it is the same instant with the `Z` on, so that is the one kept. Trimmed
because Purview writes it with a trailing space inside the quotes. */
export const purviewRecord = (row: Raw): Raw => ({
  ...JSON.parse(row.AuditData),
  CreationDate: row.CreationDate.trim(),
})

/** Purview files the interesting halves of a record as name/value pairs:
`DeviceProperties`, `ExtendedProperties`, and an admin record's `Parameters`. */
export const named = (pairs: unknown, name: string): string => {
  if (!Array.isArray(pairs)) return ""
  const found = pairs.find((pair: Raw) => pair.Name === name)
  return text(found?.Value)
}

/** Where the connection came from. Three names for the one value and only one
of them on any given record: Exchange writes `ClientIPAddress`, Entra writes
`ActorIpAddress`, and the admin records write `ClientIP` with the source port
after it. Where a record carries two they agree, so the first found is the
answer, and the port and the brackets around an IPv6 address come off because
what asks next is a lookup. */
export const purviewIp = (r: Raw): string => {
  const found = text(r.ClientIPAddress || r.ActorIpAddress || r.ClientIP)
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(found)
  if (bracketed !== null) return bracketed[1]
  const port = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(found)
  return port === null ? found : port[1]
}

/** Success or failure, from the error number where there is one. Purview files
the outcome twice and the two disagree: 326 of the 6001 `UserLoginFailed`
records in a real export say `ResultStatus: Success` next to error 50053, which
is the account-locked code. The number is the half that is right. */
export const purviewStatus = (r: Raw): string => {
  const error = text(r.ErrorNumber)
  if (error !== "") return error === "0" ? "Success" : "Failure"
  const result = text(r.ResultStatus)
  if (result === "") return ""
  return result === "Failed" || result === "False" ? "Failure" : "Success"
}

/** Which client spoke to the mailbox. Exchange writes it as the first of the
semicolon-separated pairs on `ClientInfoString`: `OWA`, `MSExchangeRPC`,
`ActiveSync`, `REST`. The same column an Entra sign-in fills with `Browser`. */
export const purviewClient = (r: Raw): string => {
  const found = /(?:^|;)Client=([^;]*)/.exec(text(r.ClientInfoString))
  return found === null ? "" : found[1]
}

/** The user agent, where the record kept one. Entra files it as an extended
property; OWA appends it whole to `ClientInfoString`, semicolons and all, so it
is taken from `Mozilla/` to the end rather than split out of the pairs. */
export const purviewUserAgent = (r: Raw): string => {
  const property = named(r.ExtendedProperties, "UserAgent")
  if (property !== "") return property
  const info = text(r.ClientInfoString)
  const at = info.indexOf("Mozilla/")
  return at === -1 ? "" : info.slice(at)
}
