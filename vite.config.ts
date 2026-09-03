import { defineConfig } from "vitest/config"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const config = defineConfig(({ command }) => ({
  resolve: { tsconfigPaths: true },
  // Bundled into the server output rather than left to node_modules. The
  // package ships every icon as its own file, 133MB of them, and a Worker
  // carries whatever the server import graph still points at. Bundling lets
  // the same tree-shake the client gets apply to it.
  //
  // The build only. `vite dev` has no bundle to keep small, and pulling the
  // package through the SSR transform instead of letting node load it put five
  // seconds on the first page of every dev server.
  ssr: { noExternal: command === "build" ? ["@tabler/icons-react"] : [] },
  // maplibre builds its worker with `new Worker(url, { type: "module" })`, so
  // it has to come out as one, not as the iife a worker is bundled to by
  // default.
  worker: { format: "es" },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
  test: { setupFiles: ["./src/test-setup.ts"] },
}))

export default config
