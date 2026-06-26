// Build-time prompt for the desktop app's share origin.
//
// Share links must resolve to a real hosted Atlas, so a desktop build has to be
// told which one. `npm run electron:build` runs this first: it asks for the URL
// and writes electron/share-origin.json, which electron/config.js reads and
// electron-builder packages into the app. Enter "none" to ship without sharing.

import { writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline"

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "electron",
  "share-origin.json"
)

// Resolve an answer to a share origin: "" disables sharing, a valid http(s) URL
// becomes its origin, anything else returns null (re-prompt).
function resolve(answer) {
  if (answer.toLowerCase() === "none") return ""
  try {
    const url = new URL(answer)
    if (url.protocol === "http:" || url.protocol === "https:") return url.origin
  } catch {
    // fall through
  }
  return null
}

console.log(
  "\nDesktop share links need a hosted Atlas to point at (it stores the\n" +
    "shared data and serves the link). Enter its URL for this build, or\n" +
    "\"none\" to build without the share feature.\n"
)

// Drive the prompt off readline's async line iterator rather than repeated
// question() calls — that avoids a race where piped input arrives between awaits
// and a line is dropped, and it ends cleanly on EOF.
const rl = createInterface({ input: process.stdin })
process.stdout.write("Share URL: ")

let shareOrigin
for await (const line of rl) {
  const answer = line.trim()
  if (answer === "") {
    process.stdout.write("  A URL is required, or \"none\" to disable.\nShare URL: ")
    continue
  }
  const resolved = resolve(answer)
  if (resolved === null) {
    process.stdout.write("  Not a valid http(s) URL. Try again, or \"none\".\nShare URL: ")
    continue
  }
  shareOrigin = resolved
  break
}
rl.close()

if (shareOrigin === undefined) {
  console.error("\nNo share URL provided; aborting build.")
  process.exit(1)
}

writeFileSync(OUT, JSON.stringify({ shareOrigin }, null, 2) + "\n")
console.log(
  shareOrigin
    ? `\nBuilding with share links pointing at ${shareOrigin}\n`
    : "\nBuilding without the share feature.\n"
)
