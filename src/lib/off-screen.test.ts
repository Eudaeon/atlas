import { expect, test } from "vitest"

import {
  angleTo,
  arrowsFor,
  clearOf,
  clump,
  covered,
  edgeSpot,
} from "@/lib/off-screen"

const frame = { width: 200, height: 100 }
const even = { top: 10, right: 10, bottom: 10, left: 10 }

test("says nothing about a point the map is already showing", () => {
  expect(edgeSpot({ x: 10, y: 10 }, frame, even)).toBeUndefined()
})

test("pulls a point off the right back to the edge", () => {
  expect(edgeSpot({ x: 300, y: 50 }, frame, even)).toEqual({
    x: 190,
    y: 50,
    angle: 0,
  })
})

test("points straight up at a point above the map", () => {
  expect(edgeSpot({ x: 100, y: -50 }, frame, even)).toEqual({
    x: 100,
    y: 10,
    angle: -90,
  })
})

test("keeps a corner inside both edges", () => {
  const spot = edgeSpot({ x: -400, y: -450 }, frame, even)!
  expect(spot.x).toBeGreaterThanOrEqual(10)
  expect(spot.y).toBeGreaterThanOrEqual(10)
  expect(spot.angle).toBeCloseTo(-135, 5)
})

test("keeps clear of whatever covers one side of the map", () => {
  const spot = edgeSpot({ x: 100, y: -50 }, frame, { ...even, top: 40 })!
  expect(spot.y).toBe(40)
})

test("draws one arrow for a stretch of edge and counts the rest into it", () => {
  const arrows = clump(
    [
      { x: 10, y: 50, angle: 180, of: "a", count: 3 },
      { x: 10, y: 60, angle: 180, of: "b", count: 9 },
      { x: 190, y: 50, angle: 0, of: "c", count: 1 },
    ],
    44
  )
  expect(arrows).toEqual([
    { x: 10, y: 60, angle: 180, of: "b", count: 12, over: 2 },
    { x: 190, y: 50, angle: 0, of: "c", count: 1, over: 1 },
  ])
})

const allowed = { top: 26, left: 26, right: 174, bottom: 74 }

test("drops an arrow out from under the app's own toolbar", () => {
  const bar = { top: 16, bottom: 40, left: 80, right: 120 }
  // Straight down is 22 away, sideways is 44: the shorter way out wins.
  expect(clearOf({ x: 100, y: 26 }, [bar], allowed, 18)).toEqual({
    x: 100,
    y: 58,
  })
  // Beside the toolbar, the edge is the edge.
  expect(clearOf({ x: 40, y: 26 }, [bar], allowed, 18)).toEqual({
    x: 40,
    y: 26,
  })
})

test("knows when a panel is sitting on a point", () => {
  const panel = { top: 16, bottom: 40, left: 80, right: 120 }
  expect(covered({ x: 100, y: 30 }, [panel], 0)).toBe(true)
  expect(covered({ x: 60, y: 30 }, [panel], 0)).toBe(false)
})

test("points an arrow back at what is hidden behind the panel", () => {
  expect(angleTo({ x: 60, y: 30 }, { x: 100, y: 30 })).toBe(0)
  expect(angleTo({ x: 60, y: 30 }, { x: 60, y: 10 })).toBe(-90)
})

/** The map's own job, faked: a point is already where it lands on screen. */
const at = (x: number, y: number, count = 1) => ({ x, y, count })
const project = (of: { x: number; y: number }) => of
const arrows = { inset: even, gap: 5, room: 20 }

test("leaves an address the map is showing in the clear without an arrow", () => {
  expect(arrowsFor([at(100, 50)], project, frame, [], arrows)).toEqual([])
})

test("points at an address the view cuts off", () => {
  expect(arrowsFor([at(300, 50)], project, frame, [], arrows)).toEqual([
    { x: 190, y: 50, angle: 0, of: at(300, 50), count: 1, over: 1 },
  ])
})

test("points back at an address a panel is sitting over", () => {
  const panel = { top: 0, bottom: 100, left: 0, right: 60 }
  const [arrow] = arrowsFor([at(30, 50)], project, frame, [panel], arrows)
  // Beside the panel rather than under it, turned back the way it came.
  expect(arrow.x).toBeGreaterThan(panel.right)
  expect(arrow.angle).toBeCloseTo(180, 5)
})

test("counts two addresses cut off the same way into one arrow", () => {
  const found = arrowsFor(
    [at(300, 50, 2), at(320, 55, 3)],
    project,
    frame,
    [],
    arrows
  )
  expect(found).toHaveLength(1)
  expect(found[0].count).toBe(5)
  expect(found[0].over).toBe(2)
})
