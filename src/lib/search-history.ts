/** How many searches are offered back. This is a shortcut for the query you
ran a minute ago, not a log of everything you have ever typed. */
const kept = 8

const store = "search-history"

/** Empty on the server, and after a browser that refuses localStorage or holds
something else under the key. */
function read(): Array<string> {
  // A render on the server reaches node's own localStorage, which warns when
  // read without a store file.
  if (typeof window === "undefined") return []
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(store) ?? "[]")
    if (!Array.isArray(saved)) return []
    return saved.filter((one) => typeof one === "string").slice(0, kept)
  } catch {
    return []
  }
}

let searches: Array<string> = read()

const save = () => {
  try {
    localStorage.setItem(store, JSON.stringify(searches))
  } catch {
    // Private mode, or a full quota. The list still stands for this tab.
    console.warn("Could not save the search history; it lasts until reload")
  }
}

export const searchHistory = () => searches

/** Puts a search at the top of the list, listed once however many times it has
been run. Returns the list, because the box that draws it is the one asking. */
export function rememberSearch(query: string): Array<string> {
  const one = query.trim()
  if (one === "") return searches
  searches = [one, ...searches.filter((past) => past !== one)].slice(0, kept)
  save()
  return searches
}

export function forgetSearches(): Array<string> {
  searches = []
  save()
  return searches
}
