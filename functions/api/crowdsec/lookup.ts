// Cloudflare Pages Function: proxy CrowdSec CTI "smoke" lookups.
//
//   POST /api/crowdsec/lookup   { ips: string[], key?: string }
//     ->   { "<ip>": <CrowdSec smoke JSON>, ... }
//
// cti.api.crowdsec.net sends no CORS headers and the API key must never reach the
// client, so the browser can't call it directly. We call it here — server-side,
// where CORS doesn't apply — with the key in the x-api-key header. The smoke
// endpoint is one IP per request, so we fan the batch out (bounded concurrency)
// and return a flat map keyed by IP, mirroring the ProxyCheck Function's shape.
//
// The key comes from the request body: a user-supplied key, like ProxyCheck.
// See https://docs.crowdsec.net/u/cti_api/intro
//
// See https://www.crowdsec.net/

const SMOKE = "https://cti.api.crowdsec.net/v2/smoke/"

// Matches the client's per-request batch (lib/crowdsec). Bounds how many upstream
// calls one invocation makes so it stays inside its time budget.
const MAX_IPS = 40
// How many upstream lookups to run at once: friendly to the rate limit while
// keeping a batch quick.
const CONCURRENCY = 8

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

// Run `worker` over `items` with at most `limit` in flight at once.
async function pool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
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

export const onRequestPost: PagesFunction = async ({ request }) => {
  let body: { ips?: unknown; key?: unknown }
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
    return json({ error: "No CrowdSec API key provided." }, 401)
  }

  const map: Record<string, unknown> = {}
  // An auth failure (bad/expired key) or a rate limit on any lookup aborts the
  // whole batch: the rest would fail the same way, and the client treats both as
  // "this key is spent" and retries the batch with another key. Everything else
  // (e.g. a 404 on one IP) is skipped so a single bad IP doesn't sink the batch.
  let authFailed = false
  let rateLimited = false
  await pool(ips as string[], CONCURRENCY, async (ip) => {
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
