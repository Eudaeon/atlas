import { useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"

import {
  createShare,
  decodeShare,
  loadShare,
  type SharePayload,
} from "@/lib/share"
import { desktop } from "@/lib/desktop"
import { quantity } from "@/lib/format"
import type { EnrichmentMap } from "@/lib/proxycheck"
import type { CrowdSecMap } from "@/lib/crowdsec"
import type { SignIn } from "@/lib/signin"

// Resolve a share reference to its payload. The reference is the `id`/`data` of
// a `?id=`/`?data=` link: an id loads from the backend, the legacy inline `data`
// decodes locally. Returns null when neither is present.
function resolveShare(id: string | null, data: string | null) {
  return id ? loadShare(id) : data ? decodeShare(data) : null
}

// Pull a share reference out of a pasted string: a full link (its `?id=`/`?data=`
// query), or a bare token treated as an id. Returns null for empty input.
function parseShareInput(input: string): Promise<SharePayload> | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    return resolveShare(
      url.searchParams.get("id"),
      url.searchParams.get("data")
    )
  } catch {
    // Not a URL — take the whole thing as an id (loadShare 404s if it's wrong).
    return resolveShare(trimmed, null)
  }
}

// Wires the share feature into the app. On mount it resolves any connections the
// current `?id=`/`?data=` link points at and hands them to `onShared`. It returns
// a `share` action that uploads the current dataset and copies a short link, and
// an `openShare` action that resolves a pasted link/id — the desktop app's way in,
// since it loads from `atlas://` with no query for the startup path to read.
export function useShareLink(onShared: (payload: SharePayload) => void) {
  const loadedRef = useRef(false)

  // On startup, load any connections referenced by the share link so a shared
  // link behaves like an upload. New links carry a `?id=` that resolves against
  // the backend; `?data=` is the legacy inline form, kept so older links still
  // open. Both resolve asynchronously, so this runs once after mount.
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    const params = new URLSearchParams(window.location.search)
    const pending = resolveShare(params.get("id"), params.get("data"))
    if (!pending) return
    pending
      .then(onShared)
      .catch(() => toast.error("Couldn't load the shared data from this link."))
  }, [onShared])

  // Resolve a pasted share link (or id) and adopt it like the startup path does.
  const openShare = useCallback(
    async (input: string) => {
      const pending = parseShareInput(input)
      if (!pending) {
        toast.error("Paste a share link or id.")
        return
      }
      try {
        onShared(await pending)
      } catch {
        toast.error("Couldn't load the shared data from this link.")
      }
    },
    [onShared]
  )

  // Save the full dataset to the backend (filters are deliberately ignored, so
  // the recipient gets everything), then copy a short `?id=` link that resolves
  // to it. Reflect the id in the address bar so the URL matches the link.
  const share = useCallback(
    async (
      rows: SignIn[],
      enrichment: EnrichmentMap,
      crowdsec: CrowdSecMap
    ) => {
      if (rows.length === 0) {
        toast.warning("No connections to share.")
        return
      }
      const label = quantity(rows.length, "connection")
      try {
        const id = await createShare(rows, enrichment, crowdsec)
        // On the web the link is this page's URL with `?id=`. In the desktop
        // app the page lives at `atlas://`, which can't be opened elsewhere, so
        // the link is built against the hosted origin the share was saved to.
        const url = new URL(desktop?.shareOrigin || window.location.href)
        url.searchParams.delete("data")
        url.searchParams.set("id", id)
        const link = url.toString()
        // Reflect the id in the address bar so the URL matches the link — only
        // meaningful on the web, where the page URL is the share URL.
        if (!desktop?.isDesktop) window.history.replaceState(null, "", link)
        await navigator.clipboard.writeText(link)
        toast.success(`Copied a share link for ${label}.`)
      } catch {
        toast.error("Couldn't create the share link.")
      }
    },
    []
  )

  return { share, openShare }
}
