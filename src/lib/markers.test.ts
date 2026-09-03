/** @vitest-environment jsdom */
import { expect, test } from "vitest"

import { abbreviate, markerRadius, pieElement } from "@/lib/markers"

const paths = (element: HTMLElement) => element.querySelectorAll("path").length

test("one user is a plain disc, several are wedges", () => {
  const one = pieElement([{ color: "red", share: 3 }], 3)
  expect(one.querySelectorAll("circle")).toHaveLength(1)
  expect(paths(one)).toBe(0)

  const three = pieElement(
    [
      { color: "red", share: 3 },
      { color: "green", share: 1 },
      { color: "blue", share: 1 },
    ],
    5
  )
  expect(paths(three)).toBe(3)
  // The first user took three of the five connections, so its wedge sweeps
  // past half the circle and asks for the long arc.
  expect(three.innerHTML).toContain("A 11 11 0 1 1")
})

test("a labelled marker is a donut with the count in it", () => {
  const cluster = pieElement([{ color: "red", share: 1 }], 40, "7")
  expect(cluster.querySelector("text")?.textContent).toBe("7")
  // A hole means the single share is drawn as a wedge, not a disc.
  expect(paths(cluster)).toBe(1)
  // Sized a step up from the same count without a label.
  expect(cluster.getAttribute("width")).toBe(String((markerRadius(40) + 5) * 2))
})

test("marker size steps with the connection count", () => {
  expect(markerRadius(1)).toBeLessThan(markerRadius(10))
  expect(markerRadius(10)).toBeLessThan(markerRadius(100))
  expect(markerRadius(100)).toBeLessThan(markerRadius(1000))
})

test("counts past a thousand are shortened", () => {
  expect(abbreviate(999)).toBe("999")
  expect(abbreviate(1200)).toBe("1.2k")
  expect(abbreviate(12000)).toBe("12k")
})
