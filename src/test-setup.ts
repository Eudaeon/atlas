// Node has a localStorage of its own now, and reading it without a store file
// warns. vitest's jsdom leaves that global in place rather than putting its own
// there, so the tests get a plain in-memory one over the top.
const store = new Map<string, string>()

Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  },
})
