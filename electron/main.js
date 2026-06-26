// Electron entry point for the Atlas desktop app.
//
// The renderer is the same Vite bundle the web build ships (dist/). Rather than
// load it over file:// — which breaks the app's absolute `/assets/...` and
// `/api/...` paths — or open a local HTTP port, it's served over a custom
// `atlas://app/` scheme via protocol.handle. Registered standard + secure, so
// the page is a secure context (localStorage, clipboard, CompressionStream and
// crypto all work as on the web). Relative `/api/...` fetches resolve to
// `atlas://app/api/...` and are answered by handlers that stand in for the
// Cloudflare Functions (electron/api/**); everything else is a dist file.

import { app, BrowserWindow, protocol, shell } from "electron"
import path from "node:path"

import { shareOrigin } from "./config.js"
import { handleApi } from "./api/index.js"
import { serveStatic } from "./static.js"

// Must run before app `ready`. A standard, secure scheme gives the renderer a
// real same-origin to fetch and store against.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "atlas",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
])

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#0a0a0a",
    autoHideMenuBar: true,
    // The window/taskbar icon for the running app. electron-builder sets the
    // installed app/installer icon (see electron-builder.yml), but the live
    // window icon on Linux/Windows comes from here — point it at the same logo
    // the web favicon uses, which Vite copies to dist/ and the package bundles.
    // (macOS ignores this and uses the .app bundle icon.) Resolves the same way
    // in dev and inside the packaged asar, relative to this file.
    icon: path.join(import.meta.dirname, "..", "dist", "logo.png"),
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Read by preload.cjs to expose window.atlas.shareOrigin to the renderer.
      additionalArguments: [`--atlas-share-origin=${shareOrigin}`],
    },
  })

  // External links (the IP-enrichment provider pages, GitHub, share links pasted
  // back in) open in the user's browser. No in-app child window is ever spawned:
  // anything else is denied outright rather than opened in a frameless window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url)
    }
    return { action: "deny" }
  })

  // Pin the top-level frame to the app's own origin. A stray link, a crafted
  // share payload, or any script-driven navigation must not be able to move the
  // window off atlas://app to a remote (or file://) page — external URLs are
  // handled by the open handler above, so in-place navigation stays internal.
  const keepOnOrigin = (event, url) => {
    if (!url.startsWith("atlas://app/")) event.preventDefault()
  }
  win.webContents.on("will-navigate", keepOnOrigin)
  win.webContents.on("will-redirect", keepOnOrigin)

  win.loadURL("atlas://app/index.html")
}

app.whenReady().then(() => {
  protocol.handle("atlas", (request) => {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith("/api/")) return handleApi(request)
    return serveStatic(pathname)
  })

  createWindow()

  // macOS: re-create a window when the dock icon is clicked and none are open.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS where apps stay resident.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
