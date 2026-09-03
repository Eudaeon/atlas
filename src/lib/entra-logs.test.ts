import { expect, test } from "vitest"
import {
  detailColumns,
  exportRows,
  parseRecordsInSlices,
  detailUnit,
  kindsIn,
  localTime,
  parseRecords,
  textColumns,
} from "./entra-logs"

const record = {
  id: "req-1",
  createdDateTime: "2026-08-21T19:48:58Z",
  userDisplayName: "Jelena VLAHOVIC",
  authenticationRequirement: "multiFactorAuthentication",
  conditionalAccessStatus: "notApplied",
  status: { errorCode: 0, failureReason: "Other." },
  deviceDetail: { displayName: "WMH0380", operatingSystem: "Windows" },
}

test("maps a successful sign-in", () => {
  const [row] = parseRecords(JSON.stringify([record]))
  expect(row["Record ID"]).toBe("req-1")
  expect(row.Name).toBe("Jelena VLAHOVIC")
  expect(row["Authentication Requirement"]).toBe("Multi")
  expect(row.Status).toBe("Success")
  expect(row.Reason).toBe("")
  expect(row.OS).toBe("Windows")
  expect(row.Browser).toBe("")
  expect(Object.keys(row)).toEqual([...textColumns, ...detailColumns])
  expect(textColumns).not.toContain("Client Session ID")
})

test("the Apple platforms keep their own capitalisation", () => {
  const os = (operatingSystem: string) =>
    parseRecords(JSON.stringify([{ deviceDetail: { operatingSystem } }]))[0].OS

  expect(os("Ios")).toBe("iOS")
  expect(os("MacOs")).toBe("macOS")
  expect(os("Ios 17.5.1")).toBe("iOS 17.5.1")
  expect(os("MacOs 14.6")).toBe("macOS 14.6")
  expect(os("Windows10")).toBe("Windows10")
})

test("keeps the date as the instant it arrived as", () => {
  const [row] = parseRecords(JSON.stringify([record]))
  expect(row.Date).toBe("2026-08-21T19:48:58Z")
  // Sorting and range queries parse this back. A localized string is NaN to
  // `Date.parse` under en-GB, de-DE and fr-FR, which sorted dates at random.
  expect(Date.parse(row.Date)).toBe(Date.parse("2026-08-21T19:48:58Z"))
})

test("renders a timestamp in the browser's locale", () => {
  expect(localTime("2026-08-21T19:48:58Z")).toBe(
    new Date("2026-08-21T19:48:58Z").toLocaleString()
  )
  expect(localTime("2026-08-21T19:48:58Z")).not.toContain("Z")
  expect(localTime("not a date")).toBe("not a date")
})

test("labels the conditional access status", () => {
  const status = (value: string) =>
    parseRecords(
      JSON.stringify([{ ...record, conditionalAccessStatus: value }])
    )[0]["Conditional Access"]
  expect(status("notApplied")).toBe("Not Applied")
  expect(status("success")).toBe("Success")
  expect(status("failure")).toBe("Failure")
  expect(status("reportOnlyFailure")).toBe("reportOnlyFailure")
})

test("keeps the failure reason when the sign-in failed", () => {
  const failed = {
    ...record,
    status: { errorCode: 50078, failureReason: "MFA expired" },
  }
  const [row] = parseRecords(JSON.stringify([failed]))
  expect(row.Status).toBe("Failure")
  expect(row.Reason).toBe("MFA expired")
})

test("unwraps a Graph { value: [...] } envelope", () => {
  expect(parseRecords(JSON.stringify({ value: [record] }))).toHaveLength(1)
})

test("rejects JSON that is not a list of records", () => {
  expect(() => parseRecords('{"foo":1}')).toThrow()
})

const lookup = {
  ip: "203.0.113.9",
  coordinates: "48.85,2.35",
  detections: [{ label: "VPN", detail: "Resi.GG" }],
  asn: "Example Telecom",
  type: "ISP",
  company: "Example",
}

test("loads its own export back as the rows it wrote", () => {
  const rows = parseRecords(JSON.stringify([record]))
  expect(parseRecords(exportRows(rows, []))).toEqual(rows)
})

test("reads its own export in slices too", async () => {
  const rows = parseRecords(JSON.stringify([record]))
  const loaded = await parseRecordsInSlices(exportRows(rows, []), () => {})
  expect(loaded.rows).toEqual(rows)
})

test("carries what ProxyCheck said about the addresses in the file", async () => {
  const rows = parseRecords(JSON.stringify([record]))
  const loaded = await parseRecordsInSlices(
    exportRows(rows, [lookup]),
    () => {}
  )
  expect(loaded.ips).toEqual([lookup])
})

test("has nothing to say about the addresses in a Graph export", async () => {
  const loaded = await parseRecordsInSlices(JSON.stringify([record]), () => {})
  expect(loaded.ips).toEqual([])
})

const policyRecord = {
  ...record,
  appliedConditionalAccessPolicies: [
    {
      id: "4c578059",
      displayName: "MFA",
      enforcedGrantControls: ["Mfa"],
      enforcedSessionControls: ["SignInFrequency", "ResiliencyDefaults"],
      result: "failure",
      conditionsSatisfied:
        "application,users,devicePlatform,ipAddressSeenByAzureAD",
      conditionsNotSatisfied: "none",
      includeRulesSatisfied: [
        { conditionalAccessCondition: "application", ruleSatisfied: "allApps" },
      ],
      excludeRulesSatisfied: [
        { conditionalAccessCondition: "users", ruleSatisfied: "namedGroup" },
      ],
    },
    {
      id: "0460ada8",
      displayName: "Per-user MFA",
      enforcedGrantControls: [],
      enforcedSessionControls: [],
      result: "notEnabled",
      conditionsSatisfied: "none",
      conditionsNotSatisfied: "none",
      includeRulesSatisfied: [],
      excludeRulesSatisfied: [],
    },
  ],
  authenticationDetails: [
    {
      authenticationStepDateTime: "2026-08-21T19:48:58Z",
      authenticationMethod: "Password",
      authenticationMethodDetail: "Password in the cloud",
      succeeded: true,
      authenticationStepResultDetail: "Correct password",
      authenticationStepRequirement: "",
    },
  ],
}

test("expands each applied conditional access policy", () => {
  const [row] = parseRecords(JSON.stringify([policyRecord]))
  const [applied, notEnabled] = row["Conditional Access Policies"]
  expect(applied.title).toBe("MFA")
  expect(applied.subtitle).toBe("4c578059")
  // Entra's own wording is the wire format. Read out as words, split at the
  // commas as well as the humps, and left alone where it is already a name.
  expect(applied.entries).toEqual([
    ["Result", "Failure"],
    ["Grant controls", "MFA"],
    ["Session controls", "Sign In Frequency, Resiliency Defaults"],
    [
      "Conditions satisfied",
      "Application, Users, Device Platform, IP Address Seen By Azure AD",
    ],
    ["Conditions not satisfied", "None"],
    ["Include: Application", "All Apps"],
    ["Exclude: Users", "Named Group"],
  ])
  expect(notEnabled.entries).toContainEqual(["Result", "Not Enabled"])
  expect(notEnabled.entries).toContainEqual(["Grant controls", "None"])
})

test("expands the authentication steps", () => {
  const [row] = parseRecords(JSON.stringify([policyRecord]))
  const [step] = row["Authentication Details"]
  expect(step.title).toBe("Password")
  expect(step.subtitle).toBe("Password in the cloud")
  expect(step.entries).toContainEqual(["Succeeded", "Yes"])
  expect(step.entries).toContainEqual([
    "Date",
    new Date("2026-08-21T19:48:58Z").toLocaleString(),
  ])
})

test("gives empty detail lists when the fields are missing", () => {
  const [row] = parseRecords(JSON.stringify([record]))
  for (const column of detailColumns) expect(row[column]).toEqual([])
})

const auditRecord = {
  id: "Directory_e868_05ZRG_65904964",
  category: "UserManagement",
  correlationId: "e868",
  result: "failure",
  resultReason: "Requested by service",
  activityDisplayName: "Update user",
  activityDateTime: "2026-08-21T19:22:07.5834499+00:00",
  loggedByService: "Core Directory",
  initiatedBy: {
    user: {
      id: "user-9",
      displayName: "Jelena VLAHOVIC",
      userPrincipalName: "jelena@example.com",
      ipAddress: "10.0.0.4",
    },
  },
  userAgent: "Mozilla/5.0",
  targetResources: [
    {
      id: "target-1",
      displayName: null,
      type: "User",
      userPrincipalName: "f.altan@example.com",
      modifiedProperties: [
        { displayName: "AccountEnabled", oldValue: "[true]", newValue: null },
        { displayName: "Department", oldValue: null, newValue: '["Sales"]' },
      ],
    },
  ],
  additionalDetails: [{ key: "UserType", value: "Member" }],
}

test("maps an audit record onto the shared columns", () => {
  const [row] = parseRecords(JSON.stringify([auditRecord]))
  expect(row["Record ID"]).toBe("Directory_e868_05ZRG_65904964")
  expect(row.Name).toBe("Jelena VLAHOVIC")
  expect(row.Email).toBe("jelena@example.com")
  expect(row["User ID"]).toBe("user-9")
  expect(row["IP Address"]).toBe("10.0.0.4")
  expect(row.Date).toBe("2026-08-21T19:22:07.5834499+00:00")
  expect(row.Status).toBe("Failure")
  expect(row.Reason).toBe("Requested by service")
  // Sign-in only columns stay empty, and the other way around.
  expect(row.Browser).toBe("")
  expect(parseRecords(JSON.stringify([record]))[0].Activity).toBe("")
})

test("maps the audit specific columns", () => {
  const [row] = parseRecords(JSON.stringify([auditRecord]))
  expect(row.Activity).toBe("Update user")
  expect(row.Category).toBe("UserManagement")
  expect(row.Service).toBe("Core Directory")
  expect(row["Target Type"]).toBe("User")
  expect(row["Target ID"]).toBe("target-1")
})

test("expands a target, splitting a display name that holds a whole record", () => {
  const [plain] = parseRecords(JSON.stringify([auditRecord]))
  const [target] = plain.Target
  expect(target.title).toBe("f.altan@example.com")
  expect(target.subtitle).toBe("target-1")
  expect(target.entries).toEqual([
    ["Type", "User"],
    ["Display name", ""],
    ["Group type", ""],
  ])

  const invite = {
    ...auditRecord,
    targetResources: [
      {
        id: "target-2",
        displayName:
          "UPN: sophie_lacabanecreative.fr#EXT#@wmh.onmicrosoft.com, Email: sophie@lacabanecreative.fr, InvitationId: ea67294e, Source: Microsoft Account",
        type: "User",
        userPrincipalName:
          "sophie_lacabanecreative.fr#EXT#@wmh.onmicrosoft.com",
      },
    ],
  }
  const [row] = parseRecords(JSON.stringify([invite]))
  expect(row.Target[0].entries).toEqual([
    ["Type", "User"],
    ["UPN", "sophie_lacabanecreative.fr#EXT#@wmh.onmicrosoft.com"],
    ["Email", "sophie@lacabanecreative.fr"],
    ["InvitationId", "ea67294e"],
    ["Source", "Microsoft Account"],
    ["Group type", ""],
  ])
  expect(detailUnit("Target")).toBe("targets")
})

test("expands every modified property, whichever target it belongs to", () => {
  const [row] = parseRecords(JSON.stringify([auditRecord]))
  const [enabled, department] = row["Modified Properties"]
  expect(enabled.title).toBe("AccountEnabled")
  expect(enabled.subtitle).toBe("f.altan@example.com")
  expect(enabled.entries).toEqual([
    ["Old", "[true]"],
    ["New", ""],
  ])
  expect(department.entries).toContainEqual(["New", '["Sales"]'])
  expect(row["Additional Details"]).toEqual([
    { title: "UserType", subtitle: "Member", entries: [] },
  ])
  expect(detailUnit("Modified Properties")).toBe("changes")
})

test("takes an app as the application when it started the audited change", () => {
  const byApp = {
    ...auditRecord,
    initiatedBy: { app: { appId: "app-7", displayName: "Azure MFA" } },
  }
  const [row] = parseRecords(JSON.stringify([byApp]))
  expect(row.Application).toBe("Azure MFA")
  expect(row["Application ID"]).toBe("app-7")
  expect(row.Name).toBe("")
})

test("parses in slices, reporting the running count", async () => {
  const many = Array.from({ length: 2_500 }, (_, index) => ({
    ...record,
    id: `req-${index}`,
  }))
  const slices: Array<Array<number>> = []
  const { rows } = await parseRecordsInSlices(
    JSON.stringify(many),
    (slice, done, total) => slices.push([slice.length, done, total])
  )
  expect(rows).toHaveLength(2_500)
  expect(rows[2_499]["Record ID"]).toBe("req-2499")
  expect(slices).toEqual([
    [1_000, 1_000, 2_500],
    [1_000, 2_000, 2_500],
    [500, 2_500, 2_500],
  ])
})

test("tells the two exports apart by whether they name an activity", () => {
  expect(kindsIn(parseRecords(JSON.stringify([auditRecord])))).toEqual([
    "audit",
  ])
  expect(kindsIn(parseRecords(JSON.stringify([record])))).toEqual(["sign-in"])
  // A file this app wrote holds whatever was on the table.
  expect(kindsIn(parseRecords(JSON.stringify([record, auditRecord])))).toEqual([
    "sign-in",
    "audit",
  ])
})
