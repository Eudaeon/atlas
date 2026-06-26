// Cloudflare Pages Function: proxy a ProxyCheck.io v2 lookup.
//
//   POST /api/proxycheck/lookup   { ips: string[], key?: string }   ->   <ProxyCheck v2 JSON>
//
// proxycheck.io sends no CORS headers, so the browser can't call it directly.
// Rather than route through a third-party CORS proxy, we call it here —
// server-side, where CORS doesn't apply — and hand the response straight back.
// The upstream is never exposed to the client, which only ever sees this
// same-origin path. The client (src/lib/proxycheck.ts) shapes the JSON; this
// Function stays a thin pass-through.
//
// See https://proxycheck.io/api/

// The v2 lookup flags this app relies on:
//   asn=1   -> provider / organisation / network type / range
//   vpn=3   -> proxy + vpn (and other detection types) reported separately
//   cur=0   -> omit currency block
// Risk is intentionally omitted: CrowdSec now supplies the risk picture (see
// functions/api/crowdsec/lookup), so we don't ask ProxyCheck for a risk score.
const FLAGS = { asn: "1", vpn: "3", cur: "0" } as const

// proxycheck.io's largest batch (paid tier) is 1000 IPs per query; reject more
// so this public endpoint can't be pushed past what the upstream accepts.
const MAX_IPS = 1000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
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

  const params = new URLSearchParams(FLAGS)
  if (typeof body.key === "string" && body.key) params.set("key", body.key)

  const upstream = await fetch(
    `https://proxycheck.io/v2/?${params.toString()}`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ips: ips.join(",") }).toString(),
    }
  )
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
