// Cloudflare Pages Function: load a share payload.
//
//   GET /api/share/:id   ->   { data: <base64url string> }
//
// Returns 404 when the id is unknown or its KV entry has expired (90-day TTL).
// The client (src/lib/share.ts `loadShare`) decompresses `data` back into rows.

interface Env {
  SHARE_KV: KVNamespace
}

// Same alphabet the ids are minted from; rejects junk paths before touching KV.
const BASE64URL = /^[A-Za-z0-9_-]+$/

function notFound(): Response {
  return new Response(JSON.stringify({ error: "Not found." }), {
    status: 404,
    headers: { "content-type": "application/json" },
  })
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const id = Array.isArray(params.id) ? params.id[0] : params.id
  if (typeof id !== "string" || !BASE64URL.test(id)) return notFound()

  const data = await env.SHARE_KV.get(`share:${id}`)
  if (data === null) return notFound()

  return new Response(JSON.stringify({ data }), {
    headers: { "content-type": "application/json" },
  })
}
