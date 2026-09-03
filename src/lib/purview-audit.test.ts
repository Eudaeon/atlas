import { expect, test } from "vitest"

import { kindOf, parseRecords } from "./entra-logs"
import { loadAppNames } from "./microsoft-apps"
import { isPurviewExport, parseCsv, purviewRecords } from "./purview-audit"

const header = "RecordId,CreationDate,RecordType,Operation,UserId,AuditData\r\n"

/** One export line. Purview quotes the date and the record, and doubles every
quote inside the record, which is the whole of the escaping this reads. */
const line = (operation: string, audit: Record<string, unknown>) =>
  `rec-1,"2026-08-31T10:18:39.0000000Z ",15,${operation},someone@example.com,` +
  `"${JSON.stringify(audit).replaceAll('"', '""')}"\r\n`

const signIn = {
  UserId: "jelena@example.com",
  UserKey: "user-1",
  Operation: "UserLoggedIn",
  Workload: "AzureActiveDirectory",
  ApplicationId: "app-1",
  ActorIpAddress: "90.79.165.54",
  ResultStatus: "Success",
  DeviceProperties: [
    { Name: "OS", Value: "Windows10" },
    { Name: "BrowserType", Value: "Edge" },
    { Name: "DisplayName", Value: "ST014" },
    { Name: "Id", Value: "dev-1" },
    { Name: "SessionId", Value: "session-1" },
  ],
  ExtendedProperties: [{ Name: "UserAgent", Value: "Mozilla/5.0 (Windows)" }],
}

test("reads quoted fields, doubled quotes and embedded commas", () => {
  const rows = parseCsv('a,"b,c","say ""hi"""\r\nd,e,f\r\n')
  expect(rows).toEqual([
    ["a", "b,c", 'say "hi"'],
    ["d", "e", "f"],
  ])
})

test("a Graph export is not mistaken for a Purview one", () => {
  expect(isPurviewExport(header)).toBe(true)
  expect(isPurviewExport('[{"id":"req-1","ipAddress":"10.0.0.4"}]')).toBe(false)
})

test("keeps only the operations we map", () => {
  const source =
    header +
    line("UserLoggedIn", signIn) +
    line("HardDelete", { ...signIn, Operation: "HardDelete" }) +
    line("Send", { ...signIn, Operation: "Send" })

  expect(purviewRecords(source).length).toBe(2)
})

test("maps a Purview sign-in onto the same columns", () => {
  const [row] = parseRecords(header + line("UserLoggedIn", signIn))

  expect(kindOf(row)).toBe("purview")
  // The date the column carries, not the one inside the record: that one has
  // no zone on it, and this one arrives with a space after the `Z`.
  expect(row.Date).toBe("2026-08-31T10:18:39.0000000Z")
  expect(row.Email).toBe("jelena@example.com")
  expect(row["User ID"]).toBe("user-1")
  expect(row["IP Address"]).toBe("90.79.165.54")
  expect(row.Status).toBe("Success")
  expect(row.OS).toBe("Windows10")
  expect(row.Browser).toBe("Edge")
  expect(row.Device).toBe("ST014")
  expect(row["Device ID"]).toBe("dev-1")
  expect(row["Session ID"]).toBe("session-1")
  expect(row["User-Agent"]).toBe("Mozilla/5.0 (Windows)")
  expect(row.Activity).toBe("UserLoggedIn")
  expect(row.Workload).toBe("AzureActiveDirectory")
})

test("the error number outranks the status beside it", () => {
  const failed = {
    ...signIn,
    Operation: "UserLoginFailed",
    ResultStatus: "Success",
    ErrorNumber: "50053",
    LogonError: "IdsLocked",
  }
  const [row] = parseRecords(header + line("UserLoginFailed", failed))

  expect(row.Status).toBe("Failure")
  expect(row.Reason).toBe("IdsLocked")
})

test("reads a mailbox record's client and address", () => {
  const mail = {
    UserId: "compta@example.com",
    Operation: "MailItemsAccessed",
    Workload: "Exchange",
    MailboxOwnerUPN: "shared@example.com",
    ClientIPAddress: "[2603:10a6:20b:3ed::7]:443",
    ClientInfoString:
      "Client=OWA;Action=ViaProxy;Mozilla/5.0 (Windows NT 10.0) Chrome/151.0",
    ResultStatus: "Succeeded",
  }
  const [row] = parseRecords(header + line("MailItemsAccessed", mail))

  expect(row["IP Address"]).toBe("2603:10a6:20b:3ed::7")
  expect(row.Client).toBe("OWA")
  expect(row["User-Agent"]).toBe("Mozilla/5.0 (Windows NT 10.0) Chrome/151.0")
  expect(row.Mailbox).toBe("shared@example.com")
  expect(row.Status).toBe("Success")
})

test("an inbox rule keeps what it was given", () => {
  const rule = {
    UserId: "contact@example.com",
    Operation: "New-InboxRule",
    Workload: "Exchange",
    ObjectId: "contact\\aa",
    ClientIP: "77.83.255.10:53100",
    Parameters: [
      { Name: "Name", Value: "aa" },
      { Name: "DeleteMessage", Value: "True" },
    ],
  }
  const [row] = parseRecords(header + line("New-InboxRule", rule))

  expect(row["IP Address"]).toBe("77.83.255.10")
  expect(row.Parameters).toEqual([
    {
      title: "New-InboxRule",
      subtitle: "contact\\aa",
      entries: [
        ["Name", "aa"],
        ["DeleteMessage", "True"],
      ],
    },
  ])
})

test("names the application Microsoft's own id belongs to", async () => {
  await loadAppNames()
  const outlook = {
    ...signIn,
    ApplicationId: "5d661950-3475-41cd-a2c3-d671a3162bc1",
  }
  const [row] = parseRecords(header + line("UserLoggedIn", outlook))

  expect(row["Application ID"]).toBe("5d661950-3475-41cd-a2c3-d671a3162bc1")
  expect(row.Application).toBe("Microsoft Outlook")
})

test("a tenant's own application is left to its id", async () => {
  await loadAppNames()
  const own = {
    ...signIn,
    ApplicationId: "11111111-2222-3333-4444-555555555555",
  }
  const [row] = parseRecords(header + line("UserLoggedIn", own))

  expect(row.Application).toBe("")
})
