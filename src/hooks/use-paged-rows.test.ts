/** @vitest-environment jsdom */

import { act, fireEvent, renderHook } from "@testing-library/react"
import { beforeAll, expect, test } from "vitest"

import { usePagedRows } from "./use-paged-rows"

const rowHeight = 33

// Stands in for the scrolling element: as tall as the rows the hook has asked
// for, one screen high, and scrollable.
const el = document.createElement("div")
let rowsMounted = () => 200
Object.defineProperties(el, {
  clientHeight: { get: () => 660 },
  scrollHeight: { get: () => rowsMounted() * rowHeight },
  scrollTop: { writable: true, value: 0 },
  scrollTo: {
    value: (options: ScrollToOptions) => {
      el.scrollTop = options.top ?? 0
    },
  },
})
const scroller = { current: el }

let nextFrame: FrameRequestCallback | undefined
beforeAll(() => {
  globalThis.requestAnimationFrame = (callback) => {
    nextFrame = callback
    return 1
  }
  globalThis.cancelAnimationFrame = () => {
    nextFrame = undefined
  }
})

const paint = async () => {
  const callback = nextFrame
  nextFrame = undefined
  await act(async () => callback!(0))
}

test("pages in rows as you scroll, one page per wall hit", async () => {
  const { result, rerender } = renderHook(
    ({ total, key }) => usePagedRows(scroller, total, key),
    { initialProps: { total: 1_000, key: "a" } }
  )
  rowsMounted = () => result.current
  expect(result.current).toBe(200)

  // Within a screen of the last row that is mounted.
  el.scrollTop = 5_280
  await act(async () => fireEvent.scroll(el))
  await paint()
  expect(result.current).toBe(200)
  await paint()
  expect(result.current).toBe(400)

  // Running out of rows moves nothing, so no scroll event fires. The wheel is
  // what tells the hook someone is pushing against the wall. Two of them still
  // buy one page.
  el.scrollTop = 12_540
  await act(async () => {
    fireEvent.wheel(el, { deltaY: 120 })
    fireEvent.wheel(el, { deltaY: 120 })
  })
  expect(result.current).toBe(400)
  await paint()
  await paint()
  expect(result.current).toBe(600)

  // A new query starts over from the top.
  rerender({ total: 1_000, key: "b" })
  expect(result.current).toBe(200)
  expect(el.scrollTop).toBe(0)
})

test("never mounts more rows than there are", async () => {
  const { result } = renderHook(() => usePagedRows(scroller, 12, "small"))
  expect(result.current).toBe(12)
  expect(nextFrame).toBeUndefined()
})
