import { expect, test } from "vitest"

import { loadFiles, visibleRows } from "./load-files"
import type { LoadedFile } from "./load-files"
import type { LogKind } from "./entra-logs"

const file = (name: string, text: string) =>
  ({ name, text: async () => text }) as File

test("keeps the files that parsed and reports the ones that did not", async () => {
  const { loaded, failures } = await loadFiles([
    file("good.json", JSON.stringify([{ id: "req-1" }, { id: "req-2" }])),
    file("truncated.json", "[{"),
    file("wrong-shape.json", JSON.stringify({ value: "nope" })),
  ])

  expect(loaded.map((each) => each.name)).toEqual(["good.json"])
  expect(loaded[0].rows).toHaveLength(2)
  expect(loaded[0].hidden).toBe(false)
  expect(loaded[0].id).toMatch(/-/)
  expect(failures).toHaveLength(2)
  expect(failures[1]).toBe("wrong-shape.json: Expected an array of records.")
})

/** One loaded file holding a single row, named after the file. Only an audit
record names an activity, which is what the kinds switch reads. */
const rowOf = (name: string, kind: LogKind) => ({
  "Record ID": name,
  Activity: kind === "audit" ? "Add member to group" : "",
})

const fileOf = (name: string, kind: LogKind, hidden: boolean) =>
  ({
    id: name,
    name,
    kinds: [kind],
    hidden,
    rows: [rowOf(name, kind)],
  }) as LoadedFile

test("leaves out the files that are hidden and the kinds that are switched off", () => {
  const files = [
    fileOf("shown.json", "sign-in", false),
    fileOf("hidden.json", "sign-in", true),
    fileOf("audit.json", "audit", false),
  ]

  expect(visibleRows(files, ["sign-in", "audit"])).toEqual([
    rowOf("shown.json", "sign-in"),
    rowOf("audit.json", "audit"),
  ])
  expect(visibleRows(files, ["sign-in"])).toEqual([
    rowOf("shown.json", "sign-in"),
  ])
  expect(visibleRows(files, [])).toEqual([])
})

test("takes the switched-off records off a file holding both kinds", () => {
  // What this app writes out is whatever was on the table, which is both kinds
  // as often as not. Read back, the switch has to reach inside the file.
  const both = {
    id: "both.json",
    name: "both.json",
    kinds: ["sign-in", "audit"],
    hidden: false,
    rows: [rowOf("a", "sign-in"), rowOf("b", "audit")],
  } as LoadedFile

  expect(visibleRows([both], ["sign-in"])).toEqual([rowOf("a", "sign-in")])
  expect(visibleRows([both], ["audit"])).toEqual([rowOf("b", "audit")])
})
