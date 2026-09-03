import { expect, test } from "vitest"

import { pointsFrom } from "@/lib/connection-points"
import type { LogRow } from "@/lib/entra-logs"

const row = (ip: string, email: string, name: string, date: string): LogRow =>
  ({ "IP Address": ip, Email: email, Name: name, Date: date }) as LogRow

const places: Record<string, string | undefined> = {
  "1.1.1.1": "48.85, 2.35",
  "2.2.2.2": "48.85, 2.35",
  "3.3.3.3": "52.52, 13.41",
}

const locate = (ip: string) =>
  places[ip] === undefined
    ? undefined
    : {
        ip,
        coordinates: places[ip],
        detections: [],
        asn: "",
        type: "",
        company: "",
      }

test("groups connections by address, busiest user first", () => {
  const points = pointsFrom(
    [
      row("1.1.1.1", "ana@example.com", "Ana", "2026-08-01T10:00:00Z"),
      row("2.2.2.2", "ana@example.com", "Ana", "2026-08-03T10:00:00Z"),
      row("1.1.1.1", "bo@example.com", "Bo", "2026-08-02T10:00:00Z"),
      row("3.3.3.3", "bo@example.com", "Bo", "2026-08-04T10:00:00Z"),
      // No lookup for this one yet, so it stays off the map.
      row("9.9.9.9", "cy@example.com", "Cy", "2026-08-05T10:00:00Z"),
    ],
    locate
  )

  // Two addresses in Paris and one in Berlin: an address each, and the two
  // Paris ones pushed apart so both stay clickable.
  expect(points.map((point) => point.ip)).toEqual([
    "1.1.1.1",
    "2.2.2.2",
    "3.3.3.3",
  ])
  const [first, second] = points
  expect(first).toMatchObject({ lat: 48.85, lon: 2.35, count: 2 })
  expect(second.lat).not.toBe(first.lat)
  expect(Math.abs(second.lat - first.lat)).toBeLessThan(0.001)
  expect(
    first.visitors.map((visitor) => [visitor.user, visitor.count])
  ).toEqual([
    ["ana@example.com", 1],
    ["bo@example.com", 1],
  ])
  // Each visitor keeps the records behind their count, for the details card.
  expect(first.visitors[0].rows).toHaveLength(1)
})

test("lists a visitor's connections newest first", () => {
  const [point] = pointsFrom(
    [
      row("1.1.1.1", "ana@example.com", "Ana", "2026-08-01T10:00:00Z"),
      row("1.1.1.1", "ana@example.com", "Ana", "2026-08-03T10:00:00Z"),
      row("1.1.1.1", "ana@example.com", "Ana", "2026-08-02T10:00:00Z"),
    ],
    locate
  )

  expect(point.visitors[0].rows.map((one) => one.Date)).toEqual([
    "2026-08-03T10:00:00Z",
    "2026-08-02T10:00:00Z",
    "2026-08-01T10:00:00Z",
  ])
})

test("gives each user its own colour", () => {
  const points = pointsFrom(
    [
      row("1.1.1.1", "ana@example.com", "Ana", "2026-08-01T10:00:00Z"),
      row("3.3.3.3", "bo@example.com", "Bo", "2026-08-02T10:00:00Z"),
    ],
    locate
  )
  const [one, two] = points.map((point) => point.visitors[0].color)
  expect(one).not.toBe(two)
  // The same user keeps its colour wherever it turns up.
  expect(
    pointsFrom([row("2.2.2.2", "ana@example.com", "Ana", "x")], locate)[0]
      .visitors[0].color
  ).toBe(
    pointsFrom([row("1.1.1.1", "ana@example.com", "Ana", "x")], locate)[0]
      .visitors[0].color
  )
})
