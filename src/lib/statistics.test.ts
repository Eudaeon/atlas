import { expect, test } from "vitest"

import { summarise, topValues } from "@/lib/statistics"
import type { LogRow } from "@/lib/entra-logs"

/** An instant written the way an export writes it, off the reader's own clock,
so a test about days says the same thing in every timezone. */
const iso = (day: number, hour: number, minute = 0) =>
  new Date(2026, 7, day, hour, minute).toISOString()

const row = (one: Partial<LogRow>): LogRow =>
  ({
    Date: "2026-08-21T10:00:00Z",
    Status: "Success",
    Email: "a@example.com",
    "IP Address": "1.1.1.1",
    ...one,
  }) as LogRow

test("counts who, from where, and how many went wrong", () => {
  const summary = summarise([
    row({}),
    row({ Email: "b@example.com", "IP Address": "2.2.2.2" }),
    row({ Status: "Failure", Date: "2026-08-22T10:00:00Z" }),
  ])
  expect(summary.users).toBe(2)
  expect(summary.addresses).toBe(2)
  expect(summary.failures).toBe(1)
  expect(summary.first).toBe("2026-08-21T10:00:00Z")
  expect(summary.last).toBe("2026-08-22T10:00:00Z")
})

test("splits each day by how its records went", () => {
  const summary = summarise([
    row({ Date: iso(22, 10) }),
    row({ Date: iso(21, 10) }),
    row({ Date: iso(21, 11), Status: "Failure" }),
  ])
  expect(summary.days).toEqual([
    { day: "2026-08-21", status: "Failure", count: 1 },
    { day: "2026-08-21", status: "Success", count: 1 },
    { day: "2026-08-22", status: "Success", count: 1 },
  ])
})

test("counts a day by the reader's clock, the way it counts an hour", () => {
  // Half past midnight and half past eleven at night: one day, wherever the
  // reader is. Sliced off the ISO string instead, one of the two lands on a
  // different day for anyone whose clock is not Greenwich's, while both hours
  // stay where they are.
  const summary = summarise([
    row({ Date: iso(21, 0, 30) }),
    row({ Date: iso(21, 23, 30) }),
  ])
  expect(summary.days).toEqual([
    { day: "2026-08-21", status: "Success", count: 2 },
  ])
  expect(summary.hours.filter((one) => one.count > 0)).toEqual([
    { hour: "00", status: "Success", count: 1 },
    { hour: "23", status: "Success", count: 1 },
  ])
})

test("leaves out a record with no date, and counts it anyway", () => {
  const summary = summarise([row({ Date: "" })])
  expect(summary.days).toEqual([])
  expect(summary.users).toBe(1)
})

const value = (one: string, count: number) => ({ key: one, value: one, count })

test("splits the day into hours, quiet ones included", () => {
  const summary = summarise([
    row({ Date: "2026-08-21T10:00:00Z" }),
    row({ Date: "2026-08-21T10:30:00Z" }),
  ])
  // Local time, so the hour these land in is whatever the machine says.
  const busy = summary.hours.filter((one) => one.count > 0)
  expect(busy).toHaveLength(1)
  expect(busy[0].count).toBe(2)
  expect(summary.hours).toHaveLength(24)
  expect(summary.hours.map((one) => one.hour)).toContain("00")
  expect(summary.hours.map((one) => one.hour)).toContain("23")
})

test("gives every value its share of the category", () => {
  const [first, second] = topValues([value("a", 3), value("b", 1)], 8)
  expect(first).toEqual({ value: "a", count: 3, share: 0.75 })
  expect(second.share).toBe(0.25)
})

test("adds everything past the cut into one last slice", () => {
  const many = Array.from({ length: 20 }, (_, at) => value(`v${at}`, 2))
  const slices = topValues(many, 6)
  expect(slices).toHaveLength(7)
  const last = slices[6]
  expect(last.value).toBe("14 more")
  expect(last.count).toBe(28)
  expect(last.rest).toBe(14)
  // Every record is accounted for, one slice or another.
  expect(slices.reduce((sum, one) => sum + one.count, 0)).toBe(40)
})

test("says nothing about leftovers when there are none", () => {
  const slices = topValues([value("a", 1), value("b", 1)], 6)
  expect(slices).toHaveLength(2)
  expect(slices.every((one) => one.rest === undefined)).toBe(true)
})
