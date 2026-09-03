import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start"

/** What the page is allowed to load and talk to, sent on every response the
router hands back.

The value here is mostly `connect-src`: this app reads a tenant's sign-in
history into the tab and never sends it anywhere but ProxyCheck, so pinning
where a request may go is what a compromised dependency runs into. The rest is
the cheap hardening that goes with it.

ponytail: `unsafe-inline` on scripts, because the document carries three inline
ones and two of them are the framework's. TanStack takes a nonce through
`router.options.ssr.nonce` and puts it on both of those, so the upgrade is a way
to hand `getRouter` a per-request value; there is no server-rendered user data
here for an injected script to arrive in, so it is not what this is guarding
against. Styles are inline because React writes `style` attributes and the map
markers carry their own. */
const policy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // The basemap. Raster tiles are fetched rather than loaded as images, so the
  // host has to be allowed for both.
  "img-src 'self' data: blob: https://services.arcgisonline.com",
  "connect-src 'self' https://services.arcgisonline.com",
  // maplibre builds its tile worker from a bundled file.
  "worker-src 'self' blob:",
  "font-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Nothing here belongs in someone else's page, and a click on a map that is
  // not the one you can see is worth nothing to anybody.
  "frame-ancestors 'none'",
].join("; ")

const headers: Record<string, string> = {
  "content-security-policy": policy,
  // What `frame-ancestors` says, for whatever still reads this instead.
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  // The addresses being looked up are in the path of nothing, but a referrer
  // is a thing sent out, and this app has no reason to send one.
  "referrer-policy": "no-referrer",
}

const securityHeaders = createMiddleware({ type: "request" }).server(
  async ({ next }) => {
    const result = await next()
    for (const [name, value] of Object.entries(headers)) {
      result.response.headers.set(name, value)
    }
    return result
  }
)

/** Server functions are same-origin RPC, so they check where a request came
from. This is the middleware Start installs by default; naming any request
middleware at all takes that default away, so it is listed here rather than
lost to the header above. */
const csrf = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
})

export const startInstance = createStart(() => ({
  requestMiddleware: [csrf, securityHeaders],
}))
