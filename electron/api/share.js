// Desktop equivalent of functions/api/share/*.
//
// Share stores a compressed payload in a Cloudflare KV namespace and returns a
// short link a recipient opens in a browser. That genuinely needs the cloud, so
// the desktop app doesn't reimplement it — it forwards to a hosted Atlas
// (`shareOrigin`, default https://atlas.pages.dev) and the renderer builds the
// copied link against that same origin. The forwarded requests and responses
// pass straight through, so src/lib/share.ts behaves identically on both builds.

import { shareOrigin } from "../config.js"
import { json } from "./json.js"

// Same alphabet the ids are minted from; rejects junk paths before forwarding.
const BASE64URL = /^[A-Za-z0-9_-]+$/

// POST /api/share   { data: <base64url string> }   ->   { id }
export async function create(request) {
  if (!shareOrigin) return json({ error: "Sharing is disabled." }, 404)

  const upstream = await fetch(`${shareOrigin}/api/share`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  }).catch(() => null)
  if (!upstream) return json({ error: "Share request failed." }, 502)

  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  })
}

// GET /api/share/:id   ->   { data: <base64url string> }
export async function load(id) {
  if (!shareOrigin) return json({ error: "Sharing is disabled." }, 404)
  if (typeof id !== "string" || !BASE64URL.test(id)) {
    return json({ error: "Not found." }, 404)
  }

  const upstream = await fetch(
    `${shareOrigin}/api/share/${encodeURIComponent(id)}`
  ).catch(() => null)
  if (!upstream) return json({ error: "Share lookup failed." }, 502)

  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  })
}
