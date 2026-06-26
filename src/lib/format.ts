// Small, pure helpers for deriving display values from a sign-in. Shared across
// the table, the map, and the faceting pipeline so a value is formatted the same
// way everywhere.

import { presentValue, type SignIn } from "@/lib/signin"

// Coerce loosely-typed values (ProxyCheck returns numbers as strings) to a
// number; non-numeric input becomes NaN so callers can guard with isFinite.
export function toNumber(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string" && value.trim() !== "") return Number(value)
  return NaN
}

// A value for display, falling back to "Unknown" when missing (empty values and
// Purview's "{PII Removed}" redaction token both count as missing).
export function text(value: unknown, fallback = "Unknown"): string {
  return presentValue(value) ?? fallback
}

export function formatDate(value?: string): string {
  if (!value) return "Unknown"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString()
}

// Milliseconds for sorting; rows without a usable date sort to the end.
export function timestamp(row: SignIn): number {
  const ms = row.createdDateTime ? new Date(row.createdDateTime).getTime() : NaN
  return Number.isNaN(ms) ? Infinity : ms
}

export function authRequirement(entry: SignIn): string {
  switch (entry.authenticationRequirement) {
    case "singleFactorAuthentication":
      return "Single-factor"
    case "multiFactorAuthentication":
      return "Multi-factor"
    default:
      return text(entry.authenticationRequirement)
  }
}

// "Name (id)" when an id is present, otherwise just the name. A redacted or empty
// id is treated as absent, so it never renders as "Name ({PII Removed})".
export function withId(
  name?: string,
  id?: string,
  fallback = "Unknown"
): string {
  const base = text(name, fallback)
  const realId = presentValue(id)
  return realId ? `${base} (${realId})` : base
}

// Browser strings look like "Edge 120.0"; split the trailing version off the
// name. Browser only applies to browser-based sign-ins (else "N/A"), and a bare
// name with no version reports an "Unknown" version.
function browserParts(entry: SignIn): { name: string; version: string } {
  if (entry.clientAppUsed !== "Browser") return { name: "N/A", version: "N/A" }
  const raw = text(entry.deviceDetail?.browser)
  if (raw === "Unknown") return { name: "Unknown", version: "Unknown" }
  const match = raw.match(/^(.*?)\s+([\d.]+)$/)
  return match
    ? { name: match[1], version: match[2] }
    : { name: raw, version: "Unknown" }
}

// Canonical casing for operating-system names that Azure reports with its own
// capitalisation (e.g. "MacOs" → "macOS", "Ios" → "iOS"). Keyed by the lowercased
// name so any casing variant normalises.
const OS_LABELS: Record<string, string> = {
  macos: "macOS",
  ios: "iOS",
}

// The operating system for display, with Azure's casing normalised. The name may
// be followed by a version ("Ios 18.7.1" → "iOS 18.7.1"), so only the leading
// name token is rewritten and the remainder is preserved.
export function operatingSystem(value?: string, fallback = "Unknown"): string {
  const raw = text(value, fallback)
  const [name, ...rest] = raw.split(" ")
  const normalized = OS_LABELS[name.toLowerCase()]
  if (!normalized) return raw
  return rest.length ? `${normalized} ${rest.join(" ")}` : normalized
}

// The operating system as a two-level facet: a group (the OS name) and a value
// (the version shown under it), so e.g. "iOS 18.7.1" reads as "18.7.1" under iOS
// and a bare "macOS" reads as "Unknown" under macOS. Casing is normalised first.
export function osFacet(entry: SignIn): { group: string; value: string } {
  const raw = operatingSystem(entry.deviceDetail?.operatingSystem)
  const [name, ...rest] = raw.split(" ")
  return { group: name, value: rest.length ? rest.join(" ") : "Unknown" }
}

// A browser's mobile variant mapped to its desktop base. Variant names are
// inconsistent ("Mobile Safari", "Chrome Mobile"), so each is listed explicitly.
const MOBILE_BROWSERS: Record<string, string> = {
  "Mobile Safari": "Safari",
  "Chrome Mobile": "Chrome",
}

// The browser as a two-level facet: a group (the browser name) and a value (the
// version shown under it). A mobile variant is folded into its desktop group with
// the "Mobile" qualifier moved into the value — so "Safari 18.5" reads as "18.5"
// and "Mobile Safari 18.7" reads as "Mobile 18.7", both under Safari (and the
// same for "Chrome" / "Chrome Mobile").
export function browserFacet(entry: SignIn): { group: string; value: string } {
  const { name, version } = browserParts(entry)
  const base = MOBILE_BROWSERS[name]
  if (base) return { group: base, value: `Mobile ${version}` }
  return { group: name, value: version }
}

// IPv4 vs IPv6, used to group IP addresses in the filter panel.
export function ipVersion(ip?: string): string {
  if (!ip) return "Unknown"
  return ip.includes(":") ? "IPv6" : "IPv4"
}

// The correctly-pluralised noun for a count ("user" / "users"), for when the
// count itself is rendered separately. Defaults to the "+s" plural; pass an
// explicit plural for irregular nouns.
export function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`
): string {
  return count === 1 ? singular : plural
}

// A localised count with its pluralised noun, e.g. "1 user", "1,234 users".
// Use this wherever the count and noun are shown together.
export function quantity(
  count: number,
  singular: string,
  plural?: string
): string {
  return `${count.toLocaleString()} ${pluralize(count, singular, plural)}`
}
