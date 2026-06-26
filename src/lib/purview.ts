// Loads Microsoft Purview / Office 365 Unified Audit Log exports (CSV) and maps
// their Entra ID sign-in events into the same `SignIn` shape the Entra JSON
// export produces, so the rest of the app (table, map, statistics, analysis)
// works identically regardless of which export the user uploaded.
//
// Each CSV row carries the real detail as a JSON blob in its `AuditData` column;
// everything we surface is pulled from there. Only interactive sign-in events
// (UserLoggedIn / UserLoginFailed) are kept — other audit operations aren't
// sign-ins and have no place on the map.

import { coerceSignIns, type ParsedSignIns, type SignIn } from "@/lib/signin"
import { MICROSOFT_APPS } from "@/lib/microsoft-apps"

// Parse RFC 4180 CSV into rows of string fields. The audit `AuditData` column is
// a quoted JSON blob full of commas and doubled-quote (`""`) escapes, so a naive
// split won't do. Runs of ordinary characters are sliced in bulk (rather than
// appended char by char) to keep large exports fast.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let i = 0
  const n = text.length

  while (i < n) {
    if (text[i] === '"') {
      // Quoted field: copy until the closing quote, treating `""` as a literal.
      i++
      while (i < n) {
        const q = text.indexOf('"', i)
        if (q === -1) {
          field += text.slice(i)
          i = n
          break
        }
        if (text[q + 1] === '"') {
          field += text.slice(i, q + 1)
          i = q + 2
          continue
        }
        field += text.slice(i, q)
        i = q + 1
        break
      }
      continue
    }

    // Unquoted run up to the next delimiter.
    let j = i
    while (j < n) {
      const c = text[j]
      if (c === "," || c === "\n" || c === "\r" || c === '"') break
      j++
    }
    field += text.slice(i, j)
    i = j

    const c = text[i]
    if (c === ",") {
      row.push(field)
      field = ""
      i++
    } else if (c === "\n" || c === "\r") {
      row.push(field)
      rows.push(row)
      row = []
      field = ""
      i += c === "\r" && text[i + 1] === "\n" ? 2 : 1
    }
    // A `"` mid-field, or end of text, falls through and is handled next loop.
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

// A name/value pair list, as used by Audit `ExtendedProperties` and
// `DeviceProperties`.
type NameValue = { Name?: string; Value?: string }

type AuditData = {
  Id?: string
  CreationTime?: string
  Operation?: string
  UserId?: string
  ClientIP?: string
  ActorIpAddress?: string
  ObjectId?: string
  ApplicationId?: string
  ErrorNumber?: string
  ExtendedProperties?: NameValue[]
  DeviceProperties?: NameValue[]
}

// Flatten a name/value list into a plain lookup.
function index(pairs?: NameValue[]): Record<string, string> {
  const out: Record<string, string> = {}
  if (pairs) for (const p of pairs) if (p.Name) out[p.Name] = p.Value ?? ""
  return out
}

// The readable name for a sign-in's resource/app GUID, or undefined to keep the
// bare GUID. Only global Microsoft first-party IDs (constant across tenants) are
// mapped; lookups are case-insensitive since exports vary in GUID casing.
function appName(objectId: string | undefined): string | undefined {
  if (!objectId) return undefined
  return MICROSOFT_APPS[objectId.toLowerCase()]
}

// Common AADSTS sign-in failure codes, mapped to a readable reason. Codes not
// listed fall back to the raw `LogonError` label (de-camel-cased).
const KNOWN_ERRORS: Record<number, string> = {
  50053: "Account locked out",
  50055: "Password expired",
  50057: "User account disabled",
  50074: "Multi-factor authentication required",
  50076: "Multi-factor authentication required",
  50079: "User must enrol for multi-factor authentication",
  50105: "User not assigned to a required role",
  50126: "Invalid username or password",
  50140: "Interrupted by keep-me-signed-in",
  50173: "Session revoked, fresh sign-in required",
  53003: "Blocked by Conditional Access",
  53004: "User must enrol for multi-factor authentication",
  65001: "Application consent required",
  700016: "Application not found in directory",
}

// Turn a CamelCase / snake_case token into a readable phrase, e.g.
// "InvalidUserNameOrPassword" → "Invalid user name or password".
function humanize(token: string): string {
  const spaced = token
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim()
  if (!spaced) return token
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

function failureReason(
  code: number,
  logonError: string | undefined,
  detail: string | undefined
): string {
  if (Number.isFinite(code) && KNOWN_ERRORS[code]) return KNOWN_ERRORS[code]
  if (logonError) return humanize(logonError)
  if (detail && detail !== "Success") return detail
  return Number.isFinite(code) && code > 0
    ? `Sign-in failed (AADSTS${code})`
    : "Sign-in failed"
}

// Whether a user-agent string is an interactive browser, as opposed to a native
// auth client (the Windows/AzureAD auth provider, ADAL/MSAL, etc.). Mirrors how
// the Entra JSON export reports `clientAppUsed` "Browser" vs "Mobile Apps and
// Desktop clients", which the CSV audit log doesn't carry directly.
function isBrowserAgent(ua: string | undefined): boolean {
  return (
    !!ua &&
    /Mozilla\//.test(ua) &&
    !/AzureAD-Authentication-Provider|ADAL|MSAL|PKeyAuth/i.test(ua)
  )
}

// The browser name for a browser sign-in. Prefers the audit log's BrowserType,
// falling back to parsing the user agent (whose order matters: Edge and Opera
// both also advertise "Chrome").
function browserName(browserType: string | undefined, ua: string): string {
  if (browserType && browserType !== "Other") return browserType
  if (/Edg(A|iOS)?\//.test(ua)) return "Edge"
  if (/OPR\/|Opera/.test(ua)) return "Opera"
  if (/Firefox\//.test(ua)) return "Firefox"
  if (/Chrome\//.test(ua)) return "Chrome"
  if (/Version\/[\d.]+.*Safari/.test(ua)) return "Safari"
  return browserType || "Other"
}

// Strip a port and IPv6 brackets so the address validates and geolocates: e.g.
// "1.2.3.4:443" → "1.2.3.4", "[2603::1]:5" → "2603::1". Bare IPv4/IPv6 unchanged
// (an un-bracketed IPv6 has many colons, so it isn't treated as host:port).
function cleanIp(value: string | undefined): string | undefined {
  if (!value) return undefined
  let v = value.trim()
  if (v.startsWith("[")) {
    const end = v.indexOf("]")
    if (end !== -1) return v.slice(1, end)
  }
  if ((v.match(/:/g) || []).length === 1) v = v.split(":")[0]
  return v || undefined
}

// Map one parsed AuditData record to a SignIn, or null if it isn't a sign-in.
function toSignIn(
  audit: AuditData,
  creationDate: string | undefined
): SignIn | null {
  const op = audit.Operation
  if (op !== "UserLoggedIn" && op !== "UserLoginFailed") return null

  // Purview emits "Not Available" (sometimes whitespace/tab-padded) for the user
  // when it couldn't resolve one. Such rows have no usable identity to map,
  // group or analyse, so drop them outright.
  const user = audit.UserId?.trim()
  if (!user || user.toLowerCase() === "not available") return null

  const ext = index(audit.ExtendedProperties)
  const dev = index(audit.DeviceProperties)
  const failed = op === "UserLoginFailed"
  // `ResultStatus` is unreliable (it reads "Success" even on UserLoginFailed),
  // so the operation name is the source of truth for the outcome.
  const code = failed ? Number(audit.ErrorNumber) || 1 : 0

  // Prefer the CSV's CreationDate column (clean UTC, trailing space) over the
  // AuditData CreationTime (no timezone, which Date would read as local).
  const created =
    creationDate?.trim() ||
    (audit.CreationTime ? `${audit.CreationTime}Z` : undefined)

  const objectId = audit.ObjectId
  const ua = ext.UserAgent || undefined
  // The audit log doesn't record the client-app category or (reliably) the
  // browser, so infer them from the user agent the way the JSON export reports
  // them. Browser only applies to interactive browser sign-ins.
  const browser = isBrowserAgent(ua)
  const clientAppUsed = browser ? "Browser" : "Mobile Apps and Desktop clients"

  return {
    id: audit.Id,
    createdDateTime: created,
    userPrincipalName: user,
    appId: objectId,
    appDisplayName: appName(objectId),
    ipAddress: cleanIp(audit.ClientIP || audit.ActorIpAddress),
    clientAppUsed,
    userAgent: ua,
    status: {
      errorCode: code,
      failureReason: failed
        ? failureReason(
            Number(audit.ErrorNumber),
            ext.LogonError,
            ext.ResultStatusDetail
          )
        : undefined,
    },
    deviceDetail: {
      displayName: dev.DisplayName || undefined,
      deviceId: dev.Id || undefined,
      operatingSystem: dev.OS || undefined,
      browser: browser ? browserName(dev.BrowserType, ua ?? "") : undefined,
    },
  }
}

// Parse a Purview audit-log CSV into sign-ins, or null if it isn't one (no
// `AuditData` column, or no sign-in events inside it).
export function coercePurviewCsv(text: string): ParsedSignIns | null {
  // Drop a leading UTF-8 BOM so the first header cell matches.
  const rows = parseCsv(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  if (rows.length < 2) return null

  const header = rows[0].map((h) => h.trim())
  const auditIdx = header.indexOf("AuditData")
  if (auditIdx === -1) return null
  const dateIdx = header.indexOf("CreationDate")

  const out: SignIn[] = []
  for (let r = 1; r < rows.length; r++) {
    const raw = rows[r][auditIdx]
    if (!raw) continue
    let audit: AuditData
    try {
      audit = JSON.parse(raw)
    } catch {
      continue
    }
    const signIn = toSignIn(
      audit,
      dateIdx === -1 ? undefined : rows[r][dateIdx]
    )
    if (signIn) out.push(signIn)
  }

  // Reuse the JSON path's normalisation (drops malformed IPs); returns null if
  // nothing usable came through.
  return out.length > 0 ? coerceSignIns(out) : null
}
