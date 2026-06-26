// Desktop equivalent of functions/api/crowdsec/lookup.ts.
//
// Like the proxycheck handler, this exists on the web only to dodge CORS and
// keep the API key off the client. In the Electron main process neither applies,
// so it calls CrowdSec CTI directly. The smoke endpoint is one IP per request,
// so a batch is fanned out (bounded concurrency) into a flat map keyed by IP,
// mirroring the proxycheck shape. The key comes from the request body; the
// client only sends a lookup once the user has set one.
//
// See https://docs.crowdsec.net/u/cti_api/intro

import { json } from "./json.js"

const SMOKE = "https://cti.api.crowdsec.net/v2/smoke/"

// Matches the client's per-request batch (src/lib/crowdsec.ts).
const MAX_IPS = 40
// How many upstream lookups to run at once: friendly to the rate limit while
// keeping a batch quick.
const CONCURRENCY = 8

// Run `worker` over `items` with at most `limit` in flight at once.
async function pool(items, limit, worker) {
  let next = 0
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++
        await worker(items[i])
      }
    }
  )
  await Promise.all(runners)
}

// POST /api/crowdsec/lookup   { ips: string[], key?: string }
export async function lookup(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: "Invalid JSON body." }, 400)
  }

  const ips = body?.ips
  if (
    !Array.isArray(ips) ||
    ips.length === 0 ||
    !ips.every((ip) => typeof ip === "string")
  ) {
    return json({ error: "Missing or invalid 'ips'." }, 400)
  }
  if (ips.length > MAX_IPS) {
    return json({ error: `Too many IPs (max ${MAX_IPS}).` }, 413)
  }

  const key = (typeof body.key === "string" && body.key) || ""
  if (!key) {
    return json({ error: "No CrowdSec API key configured." }, 401)
  }

  const map = {}
  // An auth failure (bad/expired key) or a rate limit aborts the whole batch:
  // the rest would fail the same way, and the client retries the batch with
  // another key. Everything else (e.g. a 404 on one IP) is skipped so a single
  // bad IP doesn't sink the batch.
  let authFailed = false
  let rateLimited = false
  await pool(ips, CONCURRENCY, async (ip) => {
    if (authFailed || rateLimited) return
    const res = await fetch(SMOKE + encodeURIComponent(ip), {
      headers: { "x-api-key": key, accept: "application/json" },
    }).catch(() => null)
    if (!res) return
    if (res.status === 401 || res.status === 403) {
      authFailed = true
      return
    }
    if (res.status === 429) {
      rateLimited = true
      return
    }
    if (!res.ok) return
    const data = await res.json().catch(() => null)
    if (data && typeof data === "object") map[ip] = data
  })

  if (authFailed) {
    return json({ error: "CrowdSec rejected the API key." }, 401)
  }
  if (rateLimited) {
    return json({ error: "CrowdSec rate limit reached for this key." }, 429)
  }
  return json(map)
}
