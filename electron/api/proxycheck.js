// Desktop equivalent of functions/api/proxycheck/*.
//
// On the web these are Cloudflare Functions that exist purely to dodge CORS
// (proxycheck.io sends no CORS headers). The Electron main process has no CORS,
// so it calls proxycheck.io directly. The logic mirrors the Functions so the
// renderer (src/lib/proxycheck.ts) sees the same shapes on both builds.
//
// See https://proxycheck.io/api/

import { json } from "./json.js"

// The v2 lookup flags this app relies on: asn=1 (provider/network), vpn=3
// (proxy + vpn reported separately), cur=0 (omit currency). Risk is omitted —
// CrowdSec supplies the risk picture.
const FLAGS = { asn: "1", vpn: "3", cur: "0" }

// proxycheck.io's largest batch (paid tier) is 1000 IPs per query.
const MAX_IPS = 1000

// POST /api/proxycheck/lookup   { ips: string[], key?: string }
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

  const params = new URLSearchParams(FLAGS)
  if (typeof body.key === "string" && body.key) params.set("key", body.key)

  const upstream = await fetch(`https://proxycheck.io/v2/?${params.toString()}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ips: ips.join(",") }).toString(),
  })
  if (!upstream.ok) {
    return json(
      { error: `ProxyCheck request failed (HTTP ${upstream.status}).` },
      502
    )
  }

  return new Response(await upstream.text(), {
    headers: { "content-type": "application/json" },
  })
}
