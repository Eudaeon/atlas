// Routes `atlas://app/api/...` requests to the desktop API handlers, which stand
// in for the Cloudflare Functions (functions/api/**) on the web build. Dispatch
// is by pathname + method; anything unmatched is a 404, like Pages would give.

import { json } from "./json.js"
import * as proxycheck from "./proxycheck.js"
import * as crowdsec from "./crowdsec.js"
import * as share from "./share.js"

export async function handleApi(request) {
  const { pathname } = new URL(request.url)
  const method = request.method

  if (pathname === "/api/proxycheck/lookup" && method === "POST") {
    return proxycheck.lookup(request)
  }
  if (pathname === "/api/crowdsec/lookup" && method === "POST") {
    return crowdsec.lookup(request)
  }
  if (pathname === "/api/share" && method === "POST") {
    return share.create(request)
  }
  const shareMatch = pathname.match(/^\/api\/share\/([^/]+)$/)
  if (shareMatch && method === "GET") {
    return share.load(decodeURIComponent(shareMatch[1]))
  }

  return json({ error: "Not found." }, 404)
}
