// Shared configuration for the Electron main process and preload.
//
// `shareOrigin` is the hosted Atlas the desktop app forwards share requests to.
// Share stores payloads in a Cloudflare KV namespace and hands back a short link
// meant to be opened by others, so it can't run purely locally — the desktop app
// proxies it to a real deployment and produces links pointing there.
//
// The value is baked in at build time: `npm run electron:build` prompts for it
// (required every build) and writes electron/share-origin.json (see
// scripts/set-share-origin.mjs), which is read here and packaged into the app.
// An empty value disables sharing (the renderer hides the button). There is no
// default — `npm run electron:dev` / `npm run electron`, where nothing is baked,
// fall back to ATLAS_SHARE_ORIGIN, and otherwise ship with sharing disabled.

import { readFileSync } from "node:fs"
import path from "node:path"

// The build-time value, or undefined when no build prompt has run (dev).
function bakedOrigin() {
  try {
    const file = path.join(import.meta.dirname, "share-origin.json")
    const { shareOrigin } = JSON.parse(readFileSync(file, "utf8"))
    return typeof shareOrigin === "string" ? shareOrigin : undefined
  } catch {
    return undefined
  }
}

// Baked build value wins; then the env var (dev convenience); then disabled.
// `??` so a baked empty string ("sharing disabled") is respected.
const raw = bakedOrigin() ?? process.env.ATLAS_SHARE_ORIGIN ?? ""
// Strip a trailing slash so `${shareOrigin}/api/share` never doubles up.
export const shareOrigin = raw.replace(/\/+$/, "")
