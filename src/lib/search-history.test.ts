import { beforeEach, expect, test } from "vitest"

import {
  forgetSearches,
  rememberSearch,
  searchHistory,
} from "@/lib/search-history"

beforeEach(() => {
  forgetSearches()
})

test("lists the last searches newest first, each of them once", () => {
  rememberSearch("os:Windows")
  rememberSearch("status:Failure")
  rememberSearch("os:Windows")
  expect(searchHistory()).toEqual(["os:Windows", "status:Failure"])
})

test("drops the oldest past eight, and never keeps an empty search", () => {
  for (let at = 0; at < 10; at++) rememberSearch(`query ${at}`)
  rememberSearch("   ")
  expect(searchHistory()).toHaveLength(8)
  expect(searchHistory()[0]).toBe("query 9")
  expect(searchHistory()).not.toContain("query 1")
})

// The read side is guarded on `window`, which a node test does not have, so
// what a reload picks the list back up from is what this can check.
test("writes the list where a reload will find it", () => {
  rememberSearch("browser:Chrome*")
  expect(JSON.parse(localStorage.getItem("search-history") ?? "[]")).toEqual([
    "browser:Chrome*",
  ])
  forgetSearches()
  expect(localStorage.getItem("search-history")).toBe("[]")
})
