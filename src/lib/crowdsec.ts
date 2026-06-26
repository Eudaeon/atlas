// CrowdSec CTI "smoke" enrichment — the risk side of the IP picture.
//
// ProxyCheck still supplies geolocation and network type (see lib/proxycheck);
// CrowdSec replaces ProxyCheck's single risk score with a far richer threat
// profile per IP: a reputation verdict, threat/trust/aggressiveness scores, the
// attack behaviours and CVEs the address has been seen exploiting, MITRE
// techniques, the countries it targets, and which blocklists it sits on.
//
// The CTI API sends no CORS headers and the key must stay off the client, so —
// exactly like ProxyCheck — lookups go through this app's own same-origin Pages
// Function (functions/api/crowdsec/lookup), which calls cti.api.crowdsec.net
// server-side. The smoke endpoint is one IP per request, so the Function fans
// the batch out upstream and hands back a flat map keyed by IP.
// See https://docs.crowdsec.net/u/cti_api/intro

import {
  cleanKeys,
  drainWithKeys,
  FatalKeyError,
  parseKeys,
  type RejectedKey,
  splitSize,
} from "@/lib/key-pool"

// One of CrowdSec's score blocks (last_day / last_week / last_month / overall).
// Each metric is graded 0–5; higher threat/aggressiveness is worse, trust is how
// confident CrowdSec is in the verdict.
export type CrowdSecScore = {
  aggressiveness?: number
  threat?: number
  trust?: number
  anomaly?: number
  total?: number
}

// A named, described item — behaviours, classifications, attack scenarios, MITRE
// techniques and blocklist references all share this shape.
export type CrowdSecItem = {
  name: string
  label?: string
  description?: string
  references?: string[]
}

export type CrowdSecData = {
  ip?: string
  // safe | known | suspicious | malicious | unknown
  reputation?: string | null
  // high | medium | low | none
  confidence?: string | null
  ip_range?: string | null
  as_name?: string | null
  as_num?: number | null
  background_noise?: string | null
  background_noise_score?: number | null
  location?: {
    country?: string | null
    city?: string | null
    latitude?: number | null
    longitude?: number | null
  } | null
  reverse_dns?: string | null
  proxy_or_vpn?: boolean | null
  behaviors?: CrowdSecItem[]
  history?: {
    first_seen?: string | null
    last_seen?: string | null
    full_age?: number | null
    days_age?: number | null
  } | null
  classifications?: {
    classifications?: CrowdSecItem[]
    false_positives?: CrowdSecItem[]
  } | null
  attack_details?: CrowdSecItem[]
  target_countries?: Record<string, number>
  mitre_techniques?: CrowdSecItem[]
  cves?: string[]
  scores?: {
    overall?: CrowdSecScore
    last_day?: CrowdSecScore
    last_week?: CrowdSecScore
    last_month?: CrowdSecScore
  } | null
  references?: CrowdSecItem[]
}

export type CrowdSecMap = Record<string, CrowdSecData>

const KEY_STORAGE = "crowdsec_key"

// Any number of keys can be stored; lookups are spread across them. With no keys
// CrowdSec enrichment is skipped (every lookup needs a key).
export function getCrowdSecKeys(): string[] {
  try {
    return parseKeys(localStorage.getItem(KEY_STORAGE))
  } catch {
    return []
  }
}

export function setCrowdSecKeys(keys: string[]) {
  const cleaned = cleanKeys(keys)
  if (cleaned.length) {
    localStorage.setItem(KEY_STORAGE, cleaned.join("\n"))
  } else {
    localStorage.removeItem(KEY_STORAGE)
  }
}

// The smoke endpoint is single-IP, so the Function makes one upstream call per
// address. Keep each request's batch modest so a Function invocation stays well
// inside its time budget; the client sends batches across the keys for progress.
const IPS_PER_REQUEST = 40
// A free CTI account can query a limited number of distinct IPs; cap the work per
// key so a large export can't blow through one account's quota in a single
// upload. The overall cap scales with the number of keys.
const MAX_IPS_PER_KEY = 1000

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

async function queryBatch(ips: string[], key: string): Promise<CrowdSecMap> {
  const res = await fetch("/api/crowdsec/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ips, key: key || undefined }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string
    } | null
    const message =
      body?.error ?? `CrowdSec request failed (HTTP ${res.status}).`
    // A rejected key (401/403) is fatal — retrying won't help, so the pool drops
    // it. A rate limit (429) or anything else is transient: the pool backs the
    // key off and retries the batch.
    if (res.status === 401 || res.status === 403) {
      throw new FatalKeyError(message)
    }
    throw new Error(message)
  }
  return (await res.json()) as CrowdSecMap
}

export type CrowdSecResult = {
  map: CrowdSecMap
  requested: number
  skipped: number
  // Individual keys retired during the run while other keys carried on. Empty
  // when every key held up (or when all keys failed, in which case enrichCrowdSec
  // throws instead).
  keyErrors: RejectedKey[]
}

// Look up the given IPs through the Function, spreading the batches across every
// supplied key at once (see lib/key-pool). Every lookup needs a key, so with none
// supplied nothing is looked up. Returns the map keyed by IP plus how many were
// requested and how many were dropped over the cap.
export async function enrichCrowdSec(
  ips: string[],
  keys: string[],
  onProgress?: (done: number, total: number) => void
): Promise<CrowdSecResult> {
  if (keys.length === 0) {
    return { map: {}, requested: 0, skipped: ips.length, keyErrors: [] }
  }
  const capped = ips.slice(0, MAX_IPS_PER_KEY * keys.length)
  // Split the work so every key gets a share, up to the per-request cap.
  const batches = chunk(
    capped,
    splitSize(capped.length, keys.length, IPS_PER_REQUEST)
  )

  const map: CrowdSecMap = {}
  let done = 0
  const { dropped, keyErrors } = await drainWithKeys(
    batches,
    keys,
    async (batch, key) => {
      Object.assign(map, await queryBatch(batch, key))
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

// ── Reputation → risk verdict ───────────────────────────────────────────────

export type ReputationLevel = {
  label: string
  className: string
  // Severity rank for sorting (0 = worst); benign and unknown sort last.
  rank: number
}

// Map CrowdSec's reputation verdict onto the app's risk badge. This replaces
// ProxyCheck's numeric risk score everywhere risk is surfaced (the map badge and
// filter, the statistics distribution, the analysis finding).
export function reputationLevel(data?: CrowdSecData): ReputationLevel {
  switch (data?.reputation) {
    case "malicious":
      return {
        label: "Malicious",
        className: "bg-destructive/15 text-destructive",
        rank: 0,
      }
    case "suspicious":
      return {
        label: "Suspicious",
        className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        rank: 1,
      }
    case "known":
      return {
        label: "Known",
        className: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
        rank: 2,
      }
    case "safe":
      return {
        label: "Safe",
        className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
        rank: 3,
      }
    default:
      return {
        label: "Unknown",
        className: "bg-muted text-muted-foreground",
        rank: 4,
      }
  }
}

// Whether CrowdSec considers the IP an active threat (the band the analysis view
// flags and the "dangerous" end of the risk scale).
export function isThreat(data?: CrowdSecData): boolean {
  return data?.reputation === "malicious" || data?.reputation === "suspicious"
}
