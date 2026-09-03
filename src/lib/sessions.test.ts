import { expect, test } from "vitest"

import { sessionsFrom } from "@/lib/sessions"
import type { LogRow } from "@/lib/entra-logs"

const row = (one: Partial<LogRow>): LogRow =>
  ({
    Date: "2026-08-21T10:00:00Z",
    Name: "Estelle",
    Email: "estelle@example.com",
    "IP Address": "1.1.1.1",
    "Session ID": "s-1",
    Device: "Laptop",
    OS: "Windows 10",
    Application: "Office 365",
    ...one,
  }) as LogRow

test("groups sign-ins by the session they belong to", () => {
  const sessions = sessionsFrom([
    row({ Date: "2026-08-21T10:00:00Z" }),
    row({ Date: "2026-08-21T11:00:00Z", Application: "Teams" }),
    row({ "Session ID": "s-2" }),
  ])
  expect(sessions.map((one) => one.id)).toEqual(["s-1", "s-2"])
  expect(sessions[0].rows).toHaveLength(2)
  expect(sessions[0].apps).toEqual(["Office 365", "Teams"])
  expect(sessions[0].first).toBe("2026-08-21T10:00:00Z")
  expect(sessions[0].last).toBe("2026-08-21T11:00:00Z")
})

test("leaves out the records with no session, which is every audit one", () => {
  expect(sessionsFrom([row({ "Session ID": "" })])).toEqual([])
})

test("puts a session used from two addresses first", () => {
  const sessions = sessionsFrom([
    row({ "Session ID": "quiet", Date: "2026-08-22T10:00:00Z" }),
    row({ "Session ID": "roaming", "IP Address": "1.1.1.1" }),
    row({ "Session ID": "roaming", "IP Address": "9.9.9.9" }),
  ])
  expect(sessions.map((one) => one.id)).toEqual(["roaming", "quiet"])
  expect(sessions[0].addresses).toEqual(["1.1.1.1", "9.9.9.9"])
})
