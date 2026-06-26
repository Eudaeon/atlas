// Shared JSON Response helper for the desktop API handlers, matching the
// `json()` the Cloudflare Functions use.
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}
