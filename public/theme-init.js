// Set the theme class before first paint so a dark-theme user never sees a
// flash of the light :root palette while React mounts. Mirrors the logic in
// providers/theme-provider (storageKey "theme", values dark|light|system); the
// provider re-applies the same class on mount, so the two never disagree.
//
// Loaded as an external, same-origin script (not inline) so it satisfies the
// app's `script-src 'self'` Content-Security-Policy on both the web and Electron
// builds without needing 'unsafe-inline'. A classic <script> in <head> is
// parser-blocking, so it still runs before the body renders.
;(function () {
  try {
    var stored = localStorage.getItem("theme")
    var dark =
      stored === "dark" ||
      ((stored === "system" || !stored) &&
        window.matchMedia("(prefers-color-scheme: dark)").matches)
    document.documentElement.classList.add(dark ? "dark" : "light")
  } catch (e) {}
})()
