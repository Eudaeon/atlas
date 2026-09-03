import { expect, test, vi } from "vitest"

import {
  ipInfo,
  lookupIps,
  pauseLookups,
  resumeLookups,
  setProxycheckKeys,
} from "@/lib/ip-lookup"
import type { LookupProgress } from "@/lib/ip-lookup"

/** The run itself, rather than what the store does with a result: the queue,
the batches it is drained by, and what a pause leaves behind. Its own file
because the run is module state, and these drive it from empty.

ProxyCheck is stubbed at `fetch`, so the real request and the real reading of
their answer run. A queue this short is one batch, so a pause here catches the
run with that batch still out and nothing landed yet. */

const empty = {
  network: { hostname: null, provider: null, organisation: null, type: null },
  location: null,
  detections: null,
  operator: null,
}

/** Their answer about whichever addresses the batch carried. */
const answers = (body: string) => {
  const ips = new URLSearchParams(body).get("ips")?.split(",") ?? []
  return {
    status: "ok",
    ...Object.fromEntries(ips.map((ip) => [ip, empty])),
  }
}

const resolves = (_url: string, init: RequestInit) =>
  Promise.resolve({ json: () => Promise.resolve(answers(String(init.body))) })

/** Never answers, which is what a pause catches a run in the middle of. */
const hangs = (_url: string, init: RequestInit) =>
  new Promise((_keep, fail) =>
    init.signal?.addEventListener("abort", () => fail(new Error("aborted")))
  )

test("saving a key with nothing queued starts no run", async () => {
  const asked = vi.fn()
  vi.stubGlobal("fetch", asked)
  setProxycheckKeys("some-key")
  await new Promise((over) => setTimeout(over, 0))
  // Nothing to look up, so nothing went out. This one goes first: the queue is
  // only reliably empty before the runs below fill it.
  expect(asked).not.toHaveBeenCalled()
})

test("fills the store as the batch lands, and counts the run", async () => {
  const seen: Array<LookupProgress> = []
  vi.stubGlobal("fetch", resolves)

  expect(lookupIps(["1.1.1.1", "2.2.2.2"], (one) => seen.push(one))).toBe(2)
  await vi.waitFor(() => expect(ipInfo("2.2.2.2")).toBeDefined())
  expect(ipInfo("1.1.1.1")).toBeDefined()
  expect(seen.at(-1)).toEqual({ done: 2, total: 2, paused: false })
})

test("a denied key fails the run and lets those addresses be asked about again", async () => {
  const seen: Array<LookupProgress> = []
  vi.stubGlobal("fetch", () =>
    Promise.resolve({
      json: () =>
        Promise.resolve({ status: "denied", message: "Queries exhausted." }),
    })
  )

  expect(lookupIps(["8.8.8.8"], (one) => seen.push(one))).toBe(1)
  await vi.waitFor(() => expect(seen.at(-1)?.error).toBe("Queries exhausted."))
  // Not held as asked about: the run gave up on it, so a later upload with the
  // same address queues it again rather than leaving it blank forever.
  expect(lookupIps(["8.8.8.8"], () => {})).toBe(1)
})

test("a pause keeps what it had not reached, and a resume takes it", async () => {
  const seen: Array<LookupProgress> = []
  vi.stubGlobal("fetch", hangs)

  expect(lookupIps(["4.4.4.4", "5.5.5.5"], (one) => seen.push(one))).toBe(2)
  pauseLookups()
  expect(seen.at(-1)).toEqual({ done: 0, total: 2, paused: true })

  // The aborted request rejects a turn later, and the run is only free once it
  // has. A button on a toast is never this quick.
  vi.stubGlobal("fetch", resolves)
  await new Promise((over) => setTimeout(over, 0))
  resumeLookups()
  await vi.waitFor(() => expect(ipInfo("5.5.5.5")).toBeDefined())
  expect(ipInfo("4.4.4.4")).toBeDefined()
})

test("a resume that beats the aborted request still takes the rest", async () => {
  const seen: Array<LookupProgress> = []
  vi.stubGlobal("fetch", hangs)

  expect(lookupIps(["6.6.6.6", "7.7.7.7"], (one) => seen.push(one))).toBe(2)

  // Both in the same turn, which is what a double click on the toast is: the
  // abort has not rejected yet, so the run still reads as busy.
  pauseLookups()
  vi.stubGlobal("fetch", resolves)
  resumeLookups()

  await vi.waitFor(() => expect(ipInfo("7.7.7.7")).toBeDefined())
  expect(seen.at(-1)).toEqual({ done: 2, total: 2, paused: false })
})
