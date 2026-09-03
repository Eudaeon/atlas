import { expect, test } from "vitest"

import { compileQuery, luceneFields } from "@/lib/lucene-filter"
import { parseRecords } from "@/lib/entra-logs"
import { seedIpInfo } from "@/lib/ip-lookup"
import type { LogRow } from "@/lib/entra-logs"

const row = (patch: Partial<LogRow> = {}): LogRow => ({
  "Record ID": "abc-123",
  "Correlation ID": "corr-1",
  Name: "Jelena Vlahovic",
  Email: "jelena@example.com",
  "User ID": "user-1",
  Application: "Windows Sign In",
  "Application ID": "app-1",
  "IP Address": "10.0.0.4",
  Client: "Browser",
  "User-Agent": "Mozilla/5.0",
  "Authentication Requirement": "Single",
  Status: "Success",
  Reason: "",
  Activity: "",
  Category: "",
  Service: "",
  Workload: "",
  Mailbox: "",
  "Target Type": "",
  "Target ID": "",
  Device: "LAPTOP-1",
  "Device ID": "dev-1",
  OS: "Windows 10",
  Browser: "Chrome 139.0.0",
  Date: "2026-08-21T15:04:12Z",
  "Conditional Access": "Not Applied",
  Resource: "Windows Azure Service Management API",
  "Resource ID": "res-1",
  "Session ID": "sess-1",
  "Conditional Access Policies": [
    {
      title: "Block legacy auth",
      subtitle: "pol-1",
      entries: [["Result", "notApplied"]],
    },
  ],
  "Authentication Details": [],
  Target: [],
  "Modified Properties": [],
  "Additional Details": [],
  Parameters: [],
  ...patch,
})

const matches = (query: string, patch?: Partial<LogRow>) =>
  compileQuery(query)(row(patch))

test("field names come from the pretty labels, not the JSON keys", () => {
  expect(luceneFields.get("os")).toBe("OS")
  expect(luceneFields.get("resource")).toBe("Resource")
  expect(luceneFields.get("ipAddress")).toBe("IP Address")
  expect(luceneFields.get("userAgent")).toBe("User-Agent")
  expect(luceneFields.get("recordId")).toBe("Record ID")
  expect(luceneFields.get("conditionalAccessPolicies")).toBe(
    "Conditional Access Policies"
  )
  expect(luceneFields.get("userDisplayName")).toBeUndefined()
})

test("an empty query keeps every row", () => {
  expect(matches("")).toBe(true)
  expect(matches("   ")).toBe(true)
})

test("a bare term searches every column", () => {
  expect(matches("Jelena")).toBe(true)
  expect(matches("10.0.0.4")).toBe(true)
  expect(matches("nowhere")).toBe(false)
})

test("a field term searches only that column", () => {
  expect(matches("os:Windows")).toBe(true)
  expect(matches("browser:Windows")).toBe(false)
})

test("matching is case insensitive and partial", () => {
  expect(matches("os:windows")).toBe(true)
  expect(matches("name:vlah")).toBe(true)
})

test("two bare words mean AND", () => {
  expect(matches("Jelena Chrome")).toBe(true)
  expect(matches("Jelena Firefox")).toBe(false)
})

test("AND, OR, and NOT combine terms", () => {
  expect(matches("os:Windows AND status:Success")).toBe(true)
  expect(matches("os:Windows AND status:Failure")).toBe(false)
  expect(matches("os:Linux OR status:Success")).toBe(true)
  expect(matches("NOT status:Failure")).toBe(true)
  expect(matches("status:Success AND NOT browser:Firefox")).toBe(true)
})

test("a minus negates, with or without a field", () => {
  expect(matches("-os:Linux")).toBe(true)
  expect(matches("-os:Windows")).toBe(false)
  expect(matches("Jelena -Firefox")).toBe(true)
})

test("groups apply their field to every term inside", () => {
  expect(matches("status:(Success OR Failure)")).toBe(true)
  expect(matches("status:(Failure OR Pending)")).toBe(false)
  expect(matches("(os:Linux OR os:Windows) AND name:Jelena")).toBe(true)
})

test("a quoted phrase matches as one string", () => {
  expect(matches('resource:"Azure Service Management"')).toBe(true)
  expect(matches('resource:"Service Azure"')).toBe(false)
})

test("wildcards anchor to the whole cell", () => {
  expect(matches("browser:Chrome*")).toBe(true)
  expect(matches("browser:Chrome")).toBe(true)
  expect(matches("browser:*139*")).toBe(true)
  expect(matches("browser:Chrom")).toBe(true)
  expect(matches("device:LAPTOP-?")).toBe(true)
  expect(matches("device:LAPTOP-??")).toBe(false)
})

test("a range on dates compares by time, not text", () => {
  expect(matches("date:[2026-08-01 TO 2026-09-01]")).toBe(true)
  expect(matches("date:[2026-01-01 TO 2026-02-01]")).toBe(false)
  expect(matches("date:[2026-08-01 TO *]")).toBe(true)
  // A day named as the top of a range is the whole of that day, not the
  // midnight it starts at. Asked for exclusively, the day itself is what is
  // being left out.
  expect(matches("date:[2026-08-01 TO 2026-08-21]")).toBe(true)
  expect(matches("date:[2026-08-01 TO 2026-08-21}")).toBe(false)
  // The row holds the instant, not a rendering of it, so the comparison does
  // not depend on which locale the browser is set to.
  expect(matches("date:[2026-08-21T15:00:00Z TO 2026-08-21T16:00:00Z]")).toBe(
    true
  )
  expect(matches("date:[2026-08-21T16:00:00Z TO *]")).toBe(false)
})

test("expandable columns are searchable as flattened text", () => {
  expect(matches("conditionalAccessPolicies:legacy")).toBe(true)
  expect(matches("conditionalAccessPolicies:pol-1")).toBe(true)
  expect(matches("conditionalAccessPolicies:missing")).toBe(false)
})

test("an unknown field is rejected at compile time", () => {
  expect(() => compileQuery("nope:value")).toThrow(/Unknown field "nope"/)
})

test("bad syntax throws", () => {
  expect(() => compileQuery("os:[unclosed")).toThrow()
})

const rows = parseRecords(
  JSON.stringify(
    Array.from({ length: 50 }, (_, index) => ({
      id: `req-${index}`,
      userDisplayName: `User ${index}`,
      userPrincipalName: `user${index}@example.com`,
      deviceDetail: { displayName: `dev-${index}`, operatingSystem: "Windows" },
      status: {
        errorCode: index % 5 === 0 ? 50126 : 0,
        failureReason: "Bad password",
      },
      appliedConditionalAccessPolicies: [
        {
          id: `pol-${index}`,
          displayName: "Block legacy auth",
          result: "notApplied",
        },
      ],
    }))
  )
)

const hits = (query: string) => rows.filter(compileQuery(query)).length

test("the shared haystack matches what a per-column scan would find", () => {
  expect(hits("user 12")).toBe(1)
  expect(hits("legacy")).toBe(50)
  expect(hits("zzz")).toBe(0)
  expect(hits("-zzz")).toBe(50)
  expect(hits('"Bad password"')).toBe(10)
  // Wildcards anchor to a whole cell, so they still go column by column.
  expect(hits("dev-1*")).toBe(11)
  expect(hits("Windows")).toBe(50)
  // A term cannot match across the boundary between two columns.
  expect(hits('"Windows req-1"')).toBe(0)
})

test("searches what ProxyCheck said about an address, like any other column", () => {
  seedIpInfo([
    {
      ip: "10.0.0.4",
      coordinates: "-27.4679, 153.0281",
      detections: [{ label: "VPN", detail: "Mullvad" }],
      asn: "Cloudflare, Inc.",
      type: "hosting",
      company: "Cloudflare Warp",
    },
  ])
  // Named, the way the columns are labelled on the table.
  expect(luceneFields.get("asn")).toBe("ASN")
  expect(matches("asn:Cloudflare")).toBe(true)
  expect(matches("detections:VPN AND provider:Mullvad")).toBe(true)
  expect(matches("asn:Telstra")).toBe(false)
  // Bare, which the spec says matches any column.
  expect(matches("Mullvad")).toBe(true)
  // And nothing of the sort about an address nobody has looked up.
  expect(matches("Mullvad", { "IP Address": "10.0.0.5" })).toBe(false)
})
