import { expect, test } from "vitest"

import { findings } from "@/lib/analysis"
import { compileQuery } from "@/lib/lucene-filter"
import { detailColumns, textColumns } from "@/lib/entra-logs"
import type { LogRow } from "@/lib/entra-logs"

let made = 0

const row = (one: Partial<LogRow>) =>
  ({
    "Record ID": `r-${(made += 1)}`,
    Date: "2026-08-21T10:00:00Z",
    Status: "Success",
    Email: "a@example.com",
    "IP Address": "1.1.1.1",
    "Session ID": "",
    Activity: "",
    ...one,
  }) as LogRow

const places: Record<string, string> = {
  "1.1.1.1": "48.85, 2.35",
  "2.2.2.2": "48.86, 2.34",
  "9.9.9.9": "-33.87, 151.21",
}

const networks: Record<string, string> = {
  "1.1.1.1": "Example Telecom",
  "2.2.2.2": "Example Telecom",
  "9.9.9.9": "Another Telecom",
}

const locate = (ip: string) => ({
  ip,
  coordinates: places[ip] ?? "",
  asn: networks[ip] ?? "",
  detections: ip === "6.6.6.6" ? [{ label: "Tor", detail: "" }] : [],
  type: "",
  company: "",
})

const titles = (rows: Array<LogRow>) =>
  findings(rows, locate).map((one) => one.title)

test("flags an address ProxyCheck has something against", () => {
  const found = findings([row({ "IP Address": "6.6.6.6" })], locate)
  expect(found).toHaveLength(1)
  expect(found[0].level).toBe("high")
  expect(found[0].detail).toContain("Tor")
})

test("reads Paris to Sydney in an hour as a trip nobody made", () => {
  const found = findings(
    [
      row({ Date: "2026-08-21T10:00:00Z" }),
      row({ Date: "2026-08-21T11:00:00Z", "IP Address": "9.9.9.9" }),
    ],
    locate
  )
  expect(found.map((one) => one.title)).toEqual(["Impossible travel"])
  expect(found[0].rows).toHaveLength(2)
})

test("does not read a trip off a sign-in that failed", () => {
  expect(
    titles([
      row({ Date: "2026-08-21T10:00:00Z" }),
      row({
        Date: "2026-08-21T11:00:00Z",
        "IP Address": "9.9.9.9",
        Status: "Failure",
      }),
    ])
  ).toEqual([])
})

test("leaves the same trip alone when there was time to make it", () => {
  expect(
    titles([
      row({ Date: "2026-08-21T10:00:00Z" }),
      row({ Date: "2026-08-23T10:00:00Z", "IP Address": "9.9.9.9" }),
    ])
  ).toEqual([])
})

test("counts one address failing against account after account", () => {
  const spray = Array.from({ length: 5 }, (_, at) =>
    row({ Status: "Failure", Email: `user${at}@example.com` })
  )
  expect(titles(spray)).toEqual(["One address, many accounts"])
})

test("spots a run of failures that ends in a sign-in", () => {
  const attempts = [
    ...Array.from({ length: 5 }, (_, at) =>
      row({ Status: "Failure", Date: `2026-08-21T10:0${at}:00Z` })
    ),
    row({ Status: "Success", Date: "2026-08-21T10:06:00Z" }),
  ]
  const found = findings(attempts, locate)
  expect(found.map((one) => one.title)).toEqual(["Failures, then a sign-in"])
  expect(found[0].detail).toContain("5 failures")
})

test("says nothing when the run is short, or the sign-in came first", () => {
  expect(
    titles([
      row({ Status: "Success", Date: "2026-08-21T10:00:00Z" }),
      ...Array.from({ length: 5 }, (_, at) =>
        row({ Status: "Failure", Date: `2026-08-21T10:0${at + 1}:00Z` })
      ),
    ])
  ).toEqual([])
})

test("picks the audit records that hand out access", () => {
  const found = findings(
    [
      row({ Activity: "Add member to role" }),
      row({ Activity: "Add member to role" }),
      row({ Activity: "Update user" }),
    ],
    locate
  )
  expect(found.map((one) => one.subject)).toEqual(["Add member to role"])
  expect(found[0].rows).toHaveLength(2)
})

test("puts what matters most at the top", () => {
  const found = findings(
    [row({ Activity: "Add member to role" }), row({ "IP Address": "6.6.6.6" })],
    locate
  )
  expect(found.map((one) => one.level)).toEqual(["high", "medium"])
})

test("follows a session that moved to another continent", () => {
  const found = findings(
    [
      row({ "Session ID": "s-1" }),
      row({ "Session ID": "s-1", "IP Address": "9.9.9.9" }),
    ],
    locate
  )
  const session = found.find((one) => one.id === "session:s-1")!
  expect(session.level).toBe("high")
  expect(session.detail).toContain("2 addresses")
  expect(session.detail).toContain("km apart")
})

test("leaves a session roaming inside one operator alone", () => {
  expect(
    findings(
      [
        row({ "Session ID": "s-1" }),
        row({ "Session ID": "s-1", "IP Address": "2.2.2.2" }),
      ],
      locate
    ).map((one) => one.id)
  ).toEqual([])
})

test("calls out two accounts sharing one session id", () => {
  const found = findings(
    [
      row({ "Session ID": "s-1" }),
      row({ "Session ID": "s-1", Email: "someone@example.com" }),
    ],
    locate
  )
  expect(found.map((one) => one.title)).toEqual(["One session, two accounts"])
})

/** A row with every column on it. The search reads all of them, so a row built
from a handful of fields is one the filter cannot walk. */
const whole = (one: LogRow) =>
  ({
    ...Object.fromEntries(textColumns.map((name) => [name, ""])),
    ...Object.fromEntries(detailColumns.map((name) => [name, []])),
    ...one,
  }) as LogRow

test("hands a finding a search that survives a quote in what it was built from", () => {
  // Activities and display names are put into the query as they come, and a
  // quote of their own ends the term early unless it is escaped.
  const activity = 'Update policy "Require MFA: everyone"'
  const [found] = findings([whole(row({ Activity: activity }))], locate)
  expect(compileQuery(found.query)(whole(row({ Activity: activity })))).toBe(
    true
  )
})

test("hands every finding a search that finds those records and no others", () => {
  const rows = [
    row({ "IP Address": "6.6.6.6" }),
    row({ "Session ID": "s-1" }),
    row({ "Session ID": "s-1", "IP Address": "9.9.9.9" }),
    row({ Activity: "Add member to role" }),
    ...Array.from({ length: 5 }, (_, at) =>
      row({
        Status: "Failure",
        Email: `user${at}@example.com`,
        Date: `2026-08-21T10:0${at}:00Z`,
      })
    ),
    // One account worked through from one address, then let in.
    ...Array.from({ length: 5 }, (_, at) =>
      row({
        Status: "Failure",
        Email: "zoe@example.com",
        "IP Address": "3.3.3.3",
        Date: `2026-08-21T11:0${at}:00Z`,
      })
    ),
    row({
      Email: "zoe@example.com",
      "IP Address": "3.3.3.3",
      Date: "2026-08-21T11:06:00Z",
    }),
    // Two accounts on one session id.
    row({ "Session ID": "s-2", Email: "ana@example.com" }),
    row({ "Session ID": "s-2", Email: "bo@example.com" }),
  ].map(whole)
  const found = findings(rows, locate)

  expect([...new Set(found.map((one) => one.title))].sort()).toEqual([
    "Access changed",
    "Anonymised network",
    "Failures, then a sign-in",
    "Impossible travel",
    "One address, many accounts",
    "One session, two accounts",
    "Session used from several addresses",
  ])
  // The eye on a finding puts its query in the search box, so what the map
  // draws afterwards is what the query pulls back: the records the finding
  // lists, and none of the ones it does not.
  const ids = (some: Array<LogRow>) =>
    some.map((one) => one["Record ID"]).sort()
  for (const one of found) {
    const matches = compileQuery(one.query)
    expect(ids(rows.filter(matches))).toEqual(ids(one.rows))
  }
})
