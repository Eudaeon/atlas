// The shareable `?data=` parameter packs the connections as deflate-compressed,
// base64url-encoded JSON. Deflate shrinks the highly repetitive sign-in JSON
// dramatically; base64url (URL-safe alphabet, no padding) then survives in the
// query string without the percent-encoding bloat plain base64 (+ / =) incurs —
// together keeping the link as short as possible.

import type { SignIn } from "@/lib/signin"
import type { EnrichmentMap } from "@/lib/proxycheck"
import type { CrowdSecMap } from "@/lib/crowdsec"

async function deflate(str: string): Promise<Uint8Array> {
  const stream = new Blob([str])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
  return new Response(stream).text()
}

// Chunked so large payloads don't blow the call stack on the spread.
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/")
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4))
  return Uint8Array.from(atob(b64 + pad), (c) => c.charCodeAt(0))
}

// What a share carries: the connections plus any IP enrichment already computed
// for them — both ProxyCheck (geo/network) and CrowdSec (risk). Bundling the
// enrichment means opening a share doesn't have to look the IPs up again (see
// App's load path).
export type SharePayload = {
  rows: SignIn[]
  enrichment: EnrichmentMap
  crowdsec?: CrowdSecMap
}

// Compress a payload to a base64url string.
async function encode(payload: SharePayload): Promise<string> {
  return bytesToBase64Url(await deflate(JSON.stringify(payload)))
}

// Decompress a base64url string back to a payload. Older links encoded a bare
// SignIn[] (no enrichment); those are wrapped so callers always see one shape.
// CrowdSec data is optional — links made before it existed simply omit it.
async function decode(param: string): Promise<SharePayload> {
  const parsed = JSON.parse(await inflate(base64UrlToBytes(param))) as
    | SignIn[]
    | Partial<SharePayload>
  if (Array.isArray(parsed))
    return { rows: parsed, enrichment: {}, crowdsec: {} }
  return {
    rows: parsed.rows ?? [],
    enrichment: parsed.enrichment ?? {},
    crowdsec: parsed.crowdsec ?? {},
  }
}

// Decode a legacy inline `?data=` share into a payload.
export async function decodeShare(param: string): Promise<SharePayload> {
  return decode(param)
}

// Save a share to the backend (Cloudflare Pages Function + KV) and return its
// random id. The connections and any enrichment already computed for them are
// compressed and uploaded rather than carried in the URL, so the link stays
// short and the recipient inherits the enrichment. Throws on failure so the
// caller can surface a toast.
export async function createShare(
  rows: SignIn[],
  enrichment: EnrichmentMap,
  crowdsec: CrowdSecMap
): Promise<string> {
  const data = await encode({ rows, enrichment, crowdsec })
  const res = await fetch("/api/share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data }),
  })
  if (!res.ok) {
    throw new Error(`Share request failed (HTTP ${res.status}).`)
  }
  const { id } = (await res.json()) as { id: string }
  return id
}

// Load a share previously saved with createShare, by its id. A 404 (unknown or
// expired link) surfaces as a thrown error like any other failure.
export async function loadShare(id: string): Promise<SharePayload> {
  const res = await fetch(`/api/share/${encodeURIComponent(id)}`)
  if (!res.ok) {
    throw new Error(`Share lookup failed (HTTP ${res.status}).`)
  }
  const { data } = (await res.json()) as { data: string }
  return decode(data)
}
