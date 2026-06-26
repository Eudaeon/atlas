// ProxyCheck.io v2 enrichment.
//
// proxycheck.io does not send CORS headers, so the browser can't call it
// directly. Instead we go through this app's own same-origin Pages Functions
// (functions/api/proxycheck/*), which call proxycheck.io server-side where CORS
// doesn't apply. That keeps the upstream off the client entirely — no
// third-party CORS proxy, nothing but a relative /api path in the bundle.
//
// The lookup Function applies the v2 flags (asn/vpn); we just send it the IPs
// and key. The response is keyed by IP and FLAT: provider, organisation, type,
// continent, country, latitude, longitude live at the top level, and detection
// flags are "yes"/"no" strings. Risk is no longer requested — CrowdSec supplies
// the risk picture instead (see lib/crowdsec).
// See https://proxycheck.io/api/

import {
  cleanKeys,
  drainWithKeys,
  FatalKeyError,
  parseKeys,
  type RejectedKey,
  splitSize,
} from "@/lib/key-pool"

export type ProxyData = {
  provider?: string | null
  organisation?: string | null
  type?: string | null
  continent?: string | null
  country?: string | null
  latitude?: number | null
  longitude?: number | null
  // Detection flags arrive as "yes" / "no" strings.
  proxy?: string
  vpn?: string
  compromised?: string
  scraper?: string
  tor?: string
  hosting?: string
  anonymous?: string
  operator?: { name?: string } | string | null
}

export type EnrichmentMap = Record<string, ProxyData>

const KEY_STORAGE = "proxycheck_key"

const PROXYCHECK_LIMITS = {
  withKey: { queries: 1000, ipsPerQuery: 1000 },
  withoutKey: { queries: 100, ipsPerQuery: 100 },
} as const

// Any number of keys can be stored; the lookups are spread across them. An empty
// list means keyless lookups (the lower free-tier allowance).
export function getApiKeys(): string[] {
  try {
    return parseKeys(localStorage.getItem(KEY_STORAGE))
  } catch {
    return []
  }
}

export function setApiKeys(keys: string[]) {
  const cleaned = cleanKeys(keys)
  if (cleaned.length) {
    localStorage.setItem(KEY_STORAGE, cleaned.join("\n"))
  } else {
    localStorage.removeItem(KEY_STORAGE)
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

async function queryBatch(ips: string[], key: string): Promise<EnrichmentMap> {
  const res = await fetch("/api/proxycheck/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ips, key: key || undefined }),
  })
  if (!res.ok) {
    // Anything but an outright rejection is transient (the pool retries it).
    const message = `ProxyCheck request failed (HTTP ${res.status}).`
    if (res.status === 401 || res.status === 403) {
      throw new FatalKeyError(message)
    }
    throw new Error(message)
  }

  const json = (await res.json()) as Record<string, unknown>
  const status = json.status as string | undefined
  const message = json.message as string | undefined
  if (status && status !== "ok" && status !== "warning") {
    // ProxyCheck reports a bad key in the body (HTTP 200, status "denied").
    // Treat a key/plan problem as fatal so the pool drops it; a rate-limit
    // denial is transient and retried.
    const detail = message ?? status
    if (/\bkey\b|plan|subscription|disabled/i.test(detail)) {
      throw new FatalKeyError(`ProxyCheck error: ${detail}`)
    }
    throw new Error(`ProxyCheck error: ${detail}`)
  }
  // A disabled or otherwise dead key keeps answering with geolocation data under
  // an "ok"/"warning" status, so the only sign it's spent is the message. Catch
  // the unmistakable "your key is off" phrasings and retire the key, rather than
  // silently enriching on a key the user thinks is working. Benign warnings (a
  // private IP, partial results) don't carry these words.
  if (
    message &&
    /\b(disabled|suspended|deactivated|revoked|expired)\b/i.test(message)
  ) {
    throw new FatalKeyError(`ProxyCheck error: ${message}`)
  }

  const map: EnrichmentMap = {}
  for (const [ip, value] of Object.entries(json)) {
    if (ip === "status" || ip === "query_time" || ip === "message") continue
    if (value && typeof value === "object") {
      map[ip] = value as ProxyData
    }
  }
  return map
}

export type EnrichResult = {
  map: EnrichmentMap
  requested: number
  skipped: number
  // Individual keys retired during the run while other keys carried on. Empty
  // when every key held up (or when all keys failed, in which case enrichIps
  // throws instead).
  keyErrors: RejectedKey[]
}

// Look up the IPs, spreading the batches across every supplied key at once (see
// lib/key-pool). With no keys it falls back to a single keyless worker on the
// lower free-tier allowance. The per-key query cap means total capacity scales
// with the number of keys.
export async function enrichIps(
  ips: string[],
  keys: string[],
  onProgress?: (done: number, total: number) => void
): Promise<EnrichResult> {
  const pool = keys.length ? keys : [""]
  const limits = keys.length
    ? PROXYCHECK_LIMITS.withKey
    : PROXYCHECK_LIMITS.withoutKey
  const maxIps = limits.queries * limits.ipsPerQuery * pool.length
  const capped = ips.slice(0, maxIps)
  // Split the work so every key gets a share, up to the per-request cap.
  const batches = chunk(
    capped,
    splitSize(capped.length, pool.length, limits.ipsPerQuery)
  )

  const map: EnrichmentMap = {}
  let done = 0
  const { dropped, keyErrors } = await drainWithKeys(
    batches,
    pool,
    async (batch, key) => {
      const result = await queryBatch(batch, key)
      Object.assign(map, result)
      done += batch.length
      onProgress?.(done, capped.length)
    }
  )

  // IPs in batches that exhausted their retries weren't looked up.
  const droppedCount = dropped.reduce((sum, batch) => sum + batch.length, 0)
  return {
    map,
    requested: capped.length - droppedCount,
    skipped: ips.length - capped.length + droppedCount,
    keyErrors,
  }
}

const DETECTION_ORDER = [
  "proxy",
  "vpn",
  "compromised",
  "scraper",
  "tor",
  "hosting",
  "anonymous",
] as const

const DETECTION_LABELS: Record<(typeof DETECTION_ORDER)[number], string> = {
  proxy: "Proxy",
  vpn: "VPN",
  compromised: "Compromised",
  scraper: "Scraper",
  tor: "TOR",
  hosting: "Hosting",
  anonymous: "Anonymous",
}

export function formatDetections(data?: ProxyData): string {
  if (!data) return "Unknown"
  const active = DETECTION_ORDER.filter((key) => data[key] === "yes").map(
    (key) => DETECTION_LABELS[key]
  )
  return active.length ? active.join(", ") : "None"
}

// The network type. ProxyCheck only sometimes returns an explicit `type`
// (e.g. "Business", "Hosting"); when it doesn't, fall back to the most relevant
// active detection flag so a flagged IP still shows a type. A VPN has no network
// type of its own — VPNs run on hosting infrastructure — so we report it as
// "Hosting" rather than surfacing "VPN" as a type.
export function connectionType(data?: ProxyData): string {
  if (!data) return ""
  if (data.type) return data.type
  for (const key of DETECTION_ORDER) {
    if (data[key] === "yes") {
      return key === "vpn" ? "Hosting" : DETECTION_LABELS[key]
    }
  }
  return ""
}

export function formatOperator(operator: ProxyData["operator"]): string {
  if (!operator) return "Unknown"
  if (typeof operator === "string") return operator
  return operator.name ?? "Unknown"
}
