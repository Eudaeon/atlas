// Injected by the Electron preload (electron/preload.cjs). Absent on the web,
// where `window.atlas` is undefined and the app behaves exactly as before.
interface Window {
  atlas?: {
    isDesktop: boolean
    // Origin share links point at (and the desktop API forwards share to). Empty
    // when sharing is disabled.
    shareOrigin: string
  }
}
