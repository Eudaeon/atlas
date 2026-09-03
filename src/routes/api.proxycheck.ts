import { createFileRoute } from "@tanstack/react-router"

/** The lookups, made from the server this page came off rather than from the
page itself. ProxyCheck sends no `Access-Control-Allow-Origin`, so a browser is
not allowed to read an answer of theirs, and this is what stands in. The key is
the visitor's own, sent a request at a time and kept nowhere. */
export const Route = createFileRoute("/api/proxycheck")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Same origin only. This stands in for the CORS header ProxyCheck does
        // not send, and it is not a lookup service for anyone else: without it
        // the address is a free relay to their API on this Worker's allowance.
        const from = request.headers.get("origin")
        if (from !== null && from !== new URL(request.url).origin) {
          return new Response('{"status":"denied"}', {
            status: 403,
            headers: { "content-type": "application/json" },
          })
        }
        const answer = await fetch(
          `https://proxycheck.io/v3/?key=${encodeURIComponent(
            request.headers.get("x-proxycheck-key") ?? ""
          )}`,
          {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            // Streamed rather than read into a string first: a body only has to
            // reach ProxyCheck, and reading it held all of whatever was sent in
            // this Worker's memory on the way.
            body: request.body,
            duplex: "half",
          } as RequestInit
        )
        // Their status and their JSON, both as they came: the page reads a
        // refusal off the body the same whichever side made the request.
        return new Response(answer.body, {
          status: answer.status,
          headers: { "content-type": "application/json" },
        })
      },
    },
  },
})
