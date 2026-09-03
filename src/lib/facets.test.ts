import { expect, test } from "vitest"

import {
  buildFacets,
  facetKey,
  passing,
  prepare,
  spreadDeselected,
} from "@/lib/facets"
import type { LogRow } from "@/lib/entra-logs"

const row = (ip: string, status: string, os: string): LogRow =>
  ({ "IP Address": ip, Status: status, OS: os }) as LogRow

const locate = (ip: string) => ({
  ip,
  coordinates: "48.85, 2.35",
  detections: ip === "1.1.1.1" ? [{ label: "Tor", detail: "exit node" }] : [],
  asn: "Example Telecom",
  type: "isp",
  company: "",
})

const rows = [
  row("1.1.1.1", "Failure", "Windows"),
  row("2.2.2.2", "Success", "Windows"),
  row("2.2.2.2", "Success", "iOS"),
]

test("counts each category's values, commonest first", () => {
  const facets = buildFacets(prepare(rows, locate))
  const labels = facets.map((facet) => facet.label)
  expect(labels).toContain("Status")
  // Domain is empty on every record, so there is nothing to filter by.
  expect(labels).not.toContain("Domain")

  const status = facets.find((facet) => facet.label === "Status")!
  expect(status.values).toEqual([
    { key: "Status::Success", value: "Success", count: 2 },
    { key: "Status::Failure", value: "Failure", count: 1 },
  ])
  // An address with nothing against it reads as None, not as blank.
  const detections = facets.find((facet) => facet.label === "Detections")!
  expect(detections.values.map((one) => one.value)).toEqual(["None", "Tor"])
})

test("switching off a value takes what only it carried with it", () => {
  const prepared = prepare(rows, locate)
  const off = new Set([facetKey("Status", "Failure")])
  const spread = spreadDeselected(prepared, off)

  // Only the failing connection came from that address and was flagged Tor,
  // so both drop out of the panel with it.
  expect(spread.has(facetKey("IP", "1.1.1.1"))).toBe(true)
  expect(spread.has(facetKey("Detections", "Tor"))).toBe(true)
  // Windows survives: a passing connection still runs it.
  expect(spread.has(facetKey("OS", "Windows"))).toBe(false)

  expect(passing(prepared, spread).map((one) => one["IP Address"])).toEqual([
    "2.2.2.2",
    "2.2.2.2",
  ])
})

test("no records means no categories, so the panel goes away", () => {
  expect(buildFacets(prepare([], locate))).toEqual([])
})

test("Unknown leads its category however little of it there is", () => {
  const thin = [...rows, row("2.2.2.2", "Success", "")]
  const os = buildFacets(prepare(thin, locate)).find(
    (facet) => facet.label === "OS"
  )!
  // One record against Windows' two, and still first.
  expect(os.values.map((one) => one.value)).toEqual([
    "Unknown",
    "Windows",
    "iOS",
  ])
})
