// Cloudflare Pages Function: save a share payload.
//
//   POST /api/share   { data: <base64url string> }   ->   { id }
//
// `data` is the already-compressed, base64url-encoded blob the client produces
// (src/lib/share.ts `encodeShare`). We store it opaquely in KV behind a random
// id with a 90-day TTL and return the id, which the client puts in the `?id=`
// share link. Keeping compression on the client means the Function stays a dumb
// blob store and the payload in KV is already small.

interface Env {
  SHARE_KV: KVNamespace
}

// Share data auto-expires 90 days after creation.
const TTL_SECONDS = 60 * 60 * 24 * 90
// A share is stored as a single KV value, which Workers KV caps at 25 MiB, so
// we reject just under that. ~24 MiB comfortably covers tens of thousands of
// connections (a 50k-connection export encodes to ~15 MiB); only payloads too
// large for KV to store are turned away.
const MAX_LENGTH = 24 * 1024 * 1024
// The client encodes with the URL-safe base64 alphabet (no padding).
const BASE64URL = /^[A-Za-z0-9_-]+$/

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

// A random v4 UUID. The id only has to be unguessable and unique within KV; the
// id-validation paths accept the UUID's hex-and-hyphen alphabet, and any older
// base64url ids still in their TTL window keep resolving alongside it.
function randomId(): string {
  return crypto.randomUUID()
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { data?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: "Invalid JSON body." }, 400)
  }

  const data = body?.data
  if (typeof data !== "string" || data.length === 0) {
    return json({ error: "Missing 'data'." }, 400)
  }
  if (data.length > MAX_LENGTH) {
    return json({ error: "Payload too large." }, 413)
  }
  if (!BASE64URL.test(data)) {
    return json({ error: "Malformed 'data'." }, 400)
  }

  const id = randomId()
  await env.SHARE_KV.put(`share:${id}`, data, { expirationTtl: TTL_SECONDS })
  return json({ id })
}
