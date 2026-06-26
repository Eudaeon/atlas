// Derives SOC-analyst findings from a loaded sign-in set and its IP enrichment.
//
// `analyze` is a single pure pass producing a prioritised list of findings: the
// questions an analyst triages a sign-in export with — who failed to sign in and
// from where, which connections rode anonymising or high-risk infrastructure,
// where MFA wasn't enforced, whether a single IP sprayed many accounts, and
// whether any user appears in two places too far apart to have travelled between
// them. Each finding carries the exact connections it concerns, so the UI can
// focus the map on them. Geo- and risk-derived findings only surface once
// enrichment is present; the rest work on the raw log alone.

import { type SignIn, userLabel } from "@/lib/signin"
import {
  formatDetections,
  type EnrichmentMap,
  type ProxyData,
} from "@/lib/proxycheck"
import {
  isThreat,
  reputationLevel,
  type CrowdSecData,
  type CrowdSecMap,
} from "@/lib/crowdsec"
import { pluralize, text, timestamp, toNumber } from "@/lib/format"

export type Severity = "high" | "medium" | "low" | "info"

// One supporting line under a finding. `user` is set when the line concerns a
// specific user, so the UI can colour-dot it to match the map's palette.
// `count` is the number of sign-ins the line stands for, rendered as a trailing
// badge (like the map's per-user count) rather than spelled out in `text`.
export type FindingDetail = {
  text: string
  user?: string
  count?: number
}

export type Finding = {
  id: string
  severity: Severity
  title: string
  // One-line summary of what was observed and why it matters.
  description: string
  // The offending users / IPs / pairs, one line each.
  details: FindingDetail[]
  // The connections this finding concerns, for focusing the map view on them.
  // Empty for purely informational findings with no actionable subset.
  rows: SignIn[]
}

// Cruising speed of a commercial jet is ~900 km/h; an implied speed above this
// between two sign-ins can't be physical travel. Pairs closer than this minimum
// distance are ignored so GPS/clock jitter between nearby cities doesn't trip it.
const IMPOSSIBLE_SPEED_KMH = 900
const IMPOSSIBLE_MIN_KM = 500
// A single source IP failing against this many distinct accounts looks like a
// password spray rather than one person mistyping a password.
const SPRAY_USER_THRESHOLD = 5
// Repeated failures from one account, suggestive of a brute-force attempt.
const BRUTEFORCE_THRESHOLD = 10

// Entra reports basic/legacy-auth clients by protocol name. Legacy auth can't be
// challenged for MFA, so any of these is worth flagging.
const LEGACY_CLIENTS = new Set(
  [
    "Authenticated SMTP",
    "Autodiscover",
    "Exchange ActiveSync",
    "Exchange Web Services",
    "Exchange Online PowerShell",
    "IMAP4",
    "IMAP",
    "MAPI Over HTTP",
    "Offline Address Book",
    "Outlook Anywhere (RPC over HTTP)",
    "POP3",
    "POP",
    "Reporting Web Services",
    "Other clients",
  ].map((c) => c.toLowerCase())
)

function isSuccess(row: SignIn): boolean {
  return row.status?.errorCode === 0
}

function dataFor(
  row: SignIn,
  enrichment: EnrichmentMap
): ProxyData | undefined {
  return row.ipAddress ? enrichment[row.ipAddress] : undefined
}

function threatFor(
  row: SignIn,
  crowdsec: CrowdSecMap
): CrowdSecData | undefined {
  return row.ipAddress ? crowdsec[row.ipAddress] : undefined
}

// Great-circle distance between two coordinates in kilometres.
function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const R = 6371
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Count occurrences of each key the accessor returns, skipping empties, then
// return the highest-count entries first.
function topCounts(
  rows: SignIn[],
  keyOf: (row: SignIn) => string | undefined
): { key: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = keyOf(row)
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString()
}

// ── Findings ──────────────────────────────────────────────────────────────

// Sign-ins from the same user too far apart in space for the time between them.
function impossibleTravel(
  rows: SignIn[],
  enrichment: EnrichmentMap
): Finding | null {
  const byUser = new Map<string, SignIn[]>()
  for (const row of rows) {
    const d = dataFor(row, enrichment)
    if (!d || !Number.isFinite(toNumber(d.latitude)) || !row.createdDateTime) {
      continue
    }
    const user = userLabel(row)
    let list = byUser.get(user)
    if (!list) byUser.set(user, (list = []))
    list.push(row)
  }

  const details: FindingDetail[] = []
  const affected = new Set<SignIn>()
  for (const [user, list] of byUser) {
    const ordered = list
      .filter((r) => Number.isFinite(timestamp(r)))
      .sort((a, b) => timestamp(a) - timestamp(b))
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1]
      const curr = ordered[i]
      const a = dataFor(prev, enrichment)!
      const b = dataFor(curr, enrichment)!
      const km = haversineKm(
        toNumber(a.latitude),
        toNumber(a.longitude),
        toNumber(b.latitude),
        toNumber(b.longitude)
      )
      if (km < IMPOSSIBLE_MIN_KM) continue
      const hours = (timestamp(curr) - timestamp(prev)) / 3_600_000
      if (hours <= 0) continue
      const speed = km / hours
      if (speed < IMPOSSIBLE_SPEED_KMH) continue
      details.push({
        user,
        text: `${user}: ${text(a.country, "unknown")} → ${text(
          b.country,
          "unknown"
        )}, ${fmt(km)} km in ${hours.toFixed(1)} h (~${fmt(speed)} km/h)`,
      })
      affected.add(prev)
      affected.add(curr)
    }
  }

  if (details.length === 0) return null
  const users = new Set(details.map((d) => d.user)).size
  return {
    id: "impossible-travel",
    severity: "high",
    title: "Impossible travel",
    description: `${details.length} ${pluralize(
      details.length,
      "pair"
    )} of sign-ins across ${users} ${pluralize(
      users,
      "user"
    )} are too far apart in time to be one person travelling. This can mean stolen credentials or a shared identity.`,
    details,
    rows: [...affected],
  }
}

// A single IP that failed authentication against many distinct accounts.
function passwordSpray(rows: SignIn[]): Finding | null {
  const perIp = new Map<string, { users: Set<string>; rows: SignIn[] }>()
  for (const row of rows) {
    if (isSuccess(row) || !row.ipAddress) continue
    let entry = perIp.get(row.ipAddress)
    if (!entry)
      perIp.set(row.ipAddress, (entry = { users: new Set(), rows: [] }))
    entry.users.add(userLabel(row))
    entry.rows.push(row)
  }
  const offenders = [...perIp.entries()]
    .filter(([, v]) => v.users.size >= SPRAY_USER_THRESHOLD)
    .sort((a, b) => b[1].users.size - a[1].users.size)
  if (offenders.length === 0) return null

  return {
    id: "password-spray",
    severity: "high",
    title: "Possible password spray",
    description: `${offenders.length} ${pluralize(
      offenders.length,
      "IP"
    )} failed to sign in against ${SPRAY_USER_THRESHOLD}+ distinct accounts each. This pattern points to a password spray across many accounts.`,
    details: offenders.map(([ip, v]) => ({
      text: `${ip}: ${v.users.size} ${pluralize(v.users.size, "account")}`,
      count: v.rows.length,
    })),
    rows: offenders.flatMap(([, v]) => v.rows),
  }
}

// IPs CrowdSec flags as an active threat (malicious or suspicious reputation).
function highRiskIps(rows: SignIn[], crowdsec: CrowdSecMap): Finding | null {
  const perIp = new Map<string, { threat: CrowdSecData; rows: SignIn[] }>()
  for (const row of rows) {
    const t = threatFor(row, crowdsec)
    if (!isThreat(t)) continue
    let entry = perIp.get(row.ipAddress!)
    if (!entry) perIp.set(row.ipAddress!, (entry = { threat: t!, rows: [] }))
    entry.rows.push(row)
  }
  if (perIp.size === 0) return null

  // Malicious before suspicious (reputationLevel ranks worst = lowest).
  const offenders = [...perIp.entries()].sort(
    (a, b) =>
      reputationLevel(a[1].threat).rank - reputationLevel(b[1].threat).rank
  )
  return {
    id: "high-risk-ips",
    severity: "high",
    title: "High-risk source IPs",
    description: `${perIp.size} ${pluralize(
      perIp.size,
      "IP"
    )} that CrowdSec flags as malicious or suspicious, with a recent history of abuse.`,
    details: offenders.map(([ip, v]) => ({
      text: `${ip}: ${reputationLevel(v.threat).label.toLowerCase()}`,
      count: v.rows.length,
    })),
    rows: offenders.flatMap(([, v]) => v.rows),
  }
}

// Sign-ins riding anonymising infrastructure (proxy / VPN / TOR / hosting /
// compromised / scraper / anonymous), keyed by IP.
function anonymizingInfra(
  rows: SignIn[],
  enrichment: EnrichmentMap
): Finding | null {
  const perIp = new Map<string, { detections: string; rows: SignIn[] }>()
  for (const row of rows) {
    const d = dataFor(row, enrichment)
    if (!d) continue
    const detections = formatDetections(d)
    if (detections === "None" || detections === "Unknown") continue
    let entry = perIp.get(row.ipAddress!)
    if (!entry) perIp.set(row.ipAddress!, (entry = { detections, rows: [] }))
    entry.rows.push(row)
  }
  if (perIp.size === 0) return null

  const offenders = [...perIp.entries()].sort(
    (a, b) => b[1].rows.length - a[1].rows.length
  )
  const total = offenders.reduce((sum, [, v]) => sum + v.rows.length, 0)
  return {
    id: "anonymizing-infra",
    severity: "medium",
    title: "Anonymising infrastructure",
    description: `${total} ${pluralize(
      total,
      "sign-in"
    )} from ${perIp.size} ${pluralize(
      perIp.size,
      "IP"
    )} on proxy, VPN, TOR, or hosting networks. The real location may be hidden.`,
    details: offenders.map(([ip, v]) => ({
      text: `${ip}: ${v.detections}`,
      count: v.rows.length,
    })),
    rows: offenders.flatMap(([, v]) => v.rows),
  }
}

// Accounts with a high number of failed sign-ins.
function repeatedFailures(rows: SignIn[]): Finding | null {
  const perUser = new Map<string, SignIn[]>()
  for (const row of rows) {
    if (isSuccess(row)) continue
    const user = userLabel(row)
    let list = perUser.get(user)
    if (!list) perUser.set(user, (list = []))
    list.push(row)
  }
  const offenders = [...perUser.entries()]
    .filter(([, r]) => r.length >= BRUTEFORCE_THRESHOLD)
    .sort((a, b) => b[1].length - a[1].length)
  if (offenders.length === 0) return null

  return {
    id: "repeated-failures",
    severity: "medium",
    title: "Repeated sign-in failures",
    description: `${offenders.length} ${pluralize(
      offenders.length,
      "account"
    )} reached ${BRUTEFORCE_THRESHOLD}+ failed sign-ins each. This can mean a brute-force attempt or a misconfigured client.`,
    details: offenders.map(([user, r]) => ({
      user,
      text: user,
      count: r.length,
    })),
    rows: offenders.flatMap(([, r]) => r),
  }
}

// Successful sign-ins that were only single-factor: an MFA enforcement gap.
function mfaGaps(rows: SignIn[]): Finding | null {
  const offenders = rows.filter(
    (r) =>
      isSuccess(r) &&
      r.authenticationRequirement === "singleFactorAuthentication"
  )
  if (offenders.length === 0) return null

  const perUser = new Map<string, number>()
  for (const r of offenders) {
    const user = userLabel(r)
    perUser.set(user, (perUser.get(user) ?? 0) + 1)
  }
  const sorted = [...perUser.entries()].sort((a, b) => b[1] - a[1])
  return {
    id: "mfa-gaps",
    severity: "medium",
    title: "Single-factor sign-ins succeeded",
    description: `${offenders.length} successful ${pluralize(
      offenders.length,
      "sign-in"
    )} across ${sorted.length} ${pluralize(
      sorted.length,
      "account"
    )} used a single factor. These sessions were never challenged for MFA.`,
    details: sorted.map(([user, count]) => ({
      user,
      text: user,
      count,
    })),
    rows: offenders,
  }
}

// Sign-ins over legacy/basic-auth protocols, which bypass modern MFA.
function legacyAuth(rows: SignIn[]): Finding | null {
  const offenders = rows.filter((r) =>
    r.clientAppUsed
      ? LEGACY_CLIENTS.has(r.clientAppUsed.trim().toLowerCase())
      : false
  )
  if (offenders.length === 0) return null

  const perClient = topCounts(offenders, (r) => r.clientAppUsed)
  return {
    id: "legacy-auth",
    severity: "medium",
    title: "Legacy authentication",
    description: `${offenders.length} ${pluralize(
      offenders.length,
      "sign-in"
    )} used a legacy or basic-auth client. These protocols can't enforce MFA.`,
    details: perClient.map((c) => ({
      text: c.key,
      count: c.count,
    })),
    rows: offenders,
  }
}

const SEVERITY_RANK: Record<Severity, number> = {
  high: 0,
  medium: 1,
  low: 2,
  info: 3,
}

// Compute every finding that fired for a dataset, ordered high-severity first.
export function analyze(
  rows: SignIn[],
  enrichment: EnrichmentMap,
  crowdsec: CrowdSecMap
): Finding[] {
  const findings = [
    impossibleTravel(rows, enrichment),
    passwordSpray(rows),
    highRiskIps(rows, crowdsec),
    anonymizingInfra(rows, enrichment),
    repeatedFailures(rows),
    mfaGaps(rows),
    legacyAuth(rows),
  ].filter((f): f is Finding => f !== null)

  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
  return findings
}
