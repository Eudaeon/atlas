// Serves the built SPA (dist/) over the custom `atlas://` scheme. The renderer
// is byte-for-byte the same bundle the web build ships; here it's read from disk
// and returned as a fetch Response, so the app's absolute `/assets/...` paths
// resolve to `atlas://app/assets/...` and land here. Unknown paths fall back to
// index.html so the SPA still loads.

import { readFile } from "node:fs/promises"
import path from "node:path"

const DIST = path.join(import.meta.dirname, "..", "dist")

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
}

function contentType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream"
}

// Content-Security-Policy for the renderer (Electron only — the web build is
// served by Cloudflare and unaffected). Scripts and the document base are locked
// to the app's own origin (the bundle uses no eval), which is what clears
// Electron's "insecure CSP" warning. Styles allow inline (Tailwind/Recharts/
// MapLibre inject inline styles) and the Google Fonts stylesheet; fonts, images
// and connections allow the https resources the app legitimately loads — the
// CartoCDN basemap tiles, Google Fonts, and MapLibre's blob worker. The IP-
// enrichment and share calls are same-origin `/api/...` (handled in the main
// process), so `connect-src 'self'` already covers them.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "worker-src 'self' blob:",
  "connect-src 'self' https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ")

// Resolve a request pathname to a file inside dist, refusing anything that
// escapes the directory. Returns the file's bytes, or null if it isn't there.
async function readDist(pathname) {
  const rel = pathname.replace(/^\/+/, "")
  const filePath = path.join(DIST, rel)
  if (filePath !== DIST && !filePath.startsWith(DIST + path.sep)) return null
  try {
    return await readFile(filePath)
  } catch {
    return null
  }
}

export async function serveStatic(pathname) {
  const target = pathname === "/" ? "/index.html" : pathname
  let body = await readDist(target)
  let filePath = target
  if (body === null) {
    // SPA fallback: unknown paths get index.html (the app keys off query params,
    // not client routes, but this keeps any deep link from 404ing).
    body = await readDist("/index.html")
    filePath = "/index.html"
  }
  if (body === null) {
    return new Response("Not found.", { status: 404 })
  }
  const type = contentType(filePath)
  const headers = {
    "content-type": type,
    // Never let a response be sniffed into a different type than declared.
    "x-content-type-options": "nosniff",
  }
  // Deliver the CSP on the document; it governs the whole page from there.
  if (type.startsWith("text/html")) {
    headers["content-security-policy"] = CSP
    // No referrer leaves the app (the renderer loads tiles/fonts cross-origin).
    headers["referrer-policy"] = "no-referrer"
  }
  return new Response(body, { headers })
}
