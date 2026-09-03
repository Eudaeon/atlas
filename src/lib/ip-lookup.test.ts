import { expect, test } from "vitest"

import {
  ipInfo,
  knownIps,
  lookupIps,
  receiveIpInfo,
  seedIpInfo,
} from "@/lib/ip-lookup"

const info = (ip: string, extra: Record<string, unknown> = {}) => ({
  ip,
  coordinates: "",
  detections: [],
  asn: "Example Telecom",
  type: "",
  company: "",
  ...extra,
})

test("takes what a file already knows and does not ask again", () => {
  seedIpInfo([info("1.1.1.1")])
  expect(ipInfo("1.1.1.1")?.asn).toBe("Example Telecom")
  expect(lookupIps(["1.1.1.1"], () => {})).toBe(0)
})

test("still asks about the addresses the file said nothing about", () => {
  seedIpInfo([info("2.2.2.2")])
  expect(lookupIps(["2.2.2.2", "3.3.3.3"], () => {})).toBe(1)
})

test("keeps a failed lookup out of a file, and the unknown with it", () => {
  seedIpInfo([info("4.4.4.4"), info("5.5.5.5", { error: "Nothing there" })])
  expect(knownIps(["4.4.4.4", "5.5.5.5", "6.6.6.6"])).toEqual([info("4.4.4.4")])
})

test("fills in what a half-written file leaves out", () => {
  seedIpInfo([
    { ip: "7.7.7.7" },
    { ip: "8.8.8.8", detections: [{ label: "VPN" }] },
  ])
  // The columns map over these, so an entry without them is an entry that
  // takes the table down with it.
  expect(ipInfo("7.7.7.7")?.detections).toEqual([])
  expect(ipInfo("7.7.7.7")?.asn).toBe("")
  expect(ipInfo("8.8.8.8")?.detections).toEqual([{ label: "VPN", detail: "" }])
})

test("asks again about an address a file says failed", () => {
  seedIpInfo([{ ip: "9.9.9.9", error: "Nothing there" }])
  expect(ipInfo("9.9.9.9")).toBeUndefined()
  expect(lookupIps(["9.9.9.9"], () => {})).toBe(1)
})

test("a failed lookup off the wire still has the fields the columns read", () => {
  receiveIpInfo({ ip: "10.10.10.10", error: "no lookup data in the page" })
  expect(ipInfo("10.10.10.10")?.detections).toEqual([])
  expect(ipInfo("10.10.10.10")?.error).toBe("no lookup data in the page")
})
