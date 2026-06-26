// Shape of a single Entra ID sign-in log entry (only the fields we use).
export type SignIn = {
  id?: string
  createdDateTime?: string
  userDisplayName?: string
  userPrincipalName?: string
  appDisplayName?: string
  appId?: string
  ipAddress?: string
  clientAppUsed?: string
  userAgent?: string
  authenticationRequirement?: string
  status?: {
    errorCode?: number
    failureReason?: string
  }
  deviceDetail?: {
    displayName?: string
    deviceId?: string
    operatingSystem?: string
    browser?: string
  }
}

// Microsoft Purview replaces redacted PII (e.g. device id/name) with this token
// in its exports; treat it as a missing value rather than showing it verbatim.
const REDACTED_PLACEHOLDER = "{PII Removed}"

// A field's value when it carries real content, otherwise undefined: nullish,
// empty, and the redaction placeholder all count as missing.
export function presentValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  const str = String(value)
  return str === "" || str === REDACTED_PLACEHOLDER ? undefined : str
}

// A stable label identifying the user behind a sign-in, used for colouring and
// grouping on the map.
export function userLabel(entry: SignIn): string {
  return (
    presentValue(entry.userPrincipalName) ??
    presentValue(entry.userDisplayName) ??
    "Unknown"
  )
}

// Fields that mark an object as an Entra ID sign-in entry. A real export carries
// several of these per entry; we only require one so partial/old exports still
// load, while unrelated JSON (which has none) is rejected.
const SIGN_IN_FIELDS: (keyof SignIn)[] = [
  "id",
  "createdDateTime",
  "userPrincipalName",
  "userDisplayName",
  "appDisplayName",
  "ipAddress",
  "clientAppUsed",
  "authenticationRequirement",
]

function looksLikeSignIn(value: unknown): value is SignIn {
  return (
    !!value &&
    typeof value === "object" &&
    SIGN_IN_FIELDS.some((field) => field in value)
  )
}

// Validate an IPv4 dotted-quad: four octets, each 0–255.
function isIpv4(value: string): boolean {
  const parts = value.split(".")
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  )
}

// Validate an IPv6 address, covering full, compressed (::) and IPv4-mapped
// forms. Sourced from the widely-used reference pattern.
const IPV6 =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(:[0-9a-fA-F]{1,4}){1,6}|:((:[0-9a-fA-F]{1,4}){1,7}|:)|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/

function isValidIp(value: unknown): boolean {
  return typeof value === "string" && (isIpv4(value) || IPV6.test(value))
}

// The result of normalising a parsed export: the usable rows plus how many
// entries were discarded for carrying a present-but-malformed IP, so the caller
// can tell the user what was dropped.
export type ParsedSignIns = {
  rows: SignIn[]
  dropped: number
}

// Normalise parsed JSON into a list of sign-ins, or return null if it doesn't
// look like a sign-in export. Accepts either a single entry or an array, but
// every entry must carry at least one recognised sign-in field — so valid JSON
// that isn't a sign-in export (e.g. a config or lock file) is rejected rather
// than rendered as a row of empty cells. Entries whose `ipAddress` is present
// but not a valid IPv4/IPv6 are discarded outright, since a malformed IP can't
// be geolocated and would only surface as a stray, unmappable row; the count of
// such drops is reported alongside the kept rows. An export that looks valid but
// has no usable rows left (every entry dropped) returns an empty `rows`, which
// the caller treats as a load failure.
export function coerceSignIns(parsed: unknown): ParsedSignIns | null {
  const entries = Array.isArray(parsed) ? parsed : [parsed]
  if (entries.length === 0 || !entries.every(looksLikeSignIn)) return null
  const rows = entries.filter(
    (entry) => !entry.ipAddress || isValidIp(entry.ipAddress)
  )
  return { rows, dropped: entries.length - rows.length }
}
