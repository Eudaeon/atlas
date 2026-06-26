// Preload for the desktop build. Exposes a tiny, read-only `window.atlas` so the
// renderer can tell it's running in Electron and knows which origin share links
// should point at. CommonJS (.cjs) so it loads under the default sandbox.

const { contextBridge } = require("electron")

// shareOrigin is passed from the main process via additionalArguments (see
// electron/main.js) rather than reading env in the sandboxed preload.
const arg = process.argv.find((a) => a.startsWith("--atlas-share-origin="))
const shareOrigin = arg ? arg.slice("--atlas-share-origin=".length) : ""

contextBridge.exposeInMainWorld("atlas", {
  isDesktop: true,
  shareOrigin,
})
