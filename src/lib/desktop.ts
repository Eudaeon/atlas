// Desktop (Electron) awareness for the renderer. On the web `window.atlas` is
// undefined, so `desktop` is undefined and `canShare` is true — nothing changes.
// In the Electron build the preload injects `window.atlas` (see
// electron/preload.cjs), letting the share feature point links at the hosted
// origin and hide itself when sharing is disabled.

export const desktop = typeof window !== "undefined" ? window.atlas : undefined

// Share works on the web always; on desktop only when an origin is configured
// (ATLAS_SHARE_ORIGIN), since the link must resolve to a real deployment.
export const canShare = !desktop?.isDesktop || !!desktop.shareOrigin
