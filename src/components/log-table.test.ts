/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react"
import { expect, test } from "vitest"

import { useLogTable } from "@/components/log-table"
import { parseRecords } from "@/lib/entra-logs"
import { seedIpInfo } from "@/lib/ip-lookup"

/** Sorting, which every column has to answer to: the record's own, the
expandable ones, and the ProxyCheck ones that read off a store the rows know
nothing about. */

const rows = parseRecords(
  JSON.stringify([
    {
      ipAddress: "1.1.1.1",
      appliedConditionalAccessPolicies: [{ displayName: "One" }],
    },
    { ipAddress: "2.2.2.2", appliedConditionalAccessPolicies: [] },
  ])
)

const info = (ip: string, asn: string) => ({
  ip,
  coordinates: "",
  detections: [],
  asn,
  type: "",
  company: "",
})

const table = () => renderHook(() => useLogTable(rows, ["sign-in"])).result

test("every column the table mounts can be sorted", () => {
  const seen = table()
    .current.table.getAllColumns()
    .filter((column) => !column.getCanSort())
  expect(seen.map((column) => column.id)).toEqual([])
})

test("sorts an expandable column by how much it holds", () => {
  const instance = table()
  // Ascending, so the record that went through no policies sorts above the one
  // that went through one.
  act(() =>
    instance.current.table
      .getColumn("Conditional Access Policies")!
      .toggleSorting(false)
  )
  expect(
    instance.current.table
      .getRowModel()
      .rows.map((row) => row.original["IP Address"])
  ).toEqual(["2.2.2.2", "1.1.1.1"])
})

test("sorts a ProxyCheck column by what has landed, not by what a row cached", () => {
  const instance = table()
  // Read once with nothing looked up, which is the state most of a run is in:
  // the row remembers the empty answer.
  expect(instance.current.table.getRowModel().rows[0].getValue("ASN")).toBe("")

  seedIpInfo([
    info("1.1.1.1", "Zulu Telecom"),
    info("2.2.2.2", "Alpha Telecom"),
  ])
  act(() => instance.current.table.getColumn("ASN")!.toggleSorting())

  expect(
    instance.current.table
      .getRowModel()
      .rows.map((row) => row.original["IP Address"])
  ).toEqual(["2.2.2.2", "1.1.1.1"])
})
