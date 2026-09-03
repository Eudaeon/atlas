import { expect, test, vi } from "vitest"

import { enrichAll } from "@/lib/proxycheck"
import type { Answer } from "@/lib/proxycheck"

/** One address as their v3 API sends it, trimmed to the sections the columns
read. The keys they have nothing for arrive as null rather than missing. */
const tor = {
  network: {
    asn: "AS60729",
    range: "185.220.101.1/28",
    hostname: "berlin01.tor-exit.artikel10.org",
    provider: "Stiftung Erneuerbare Freiheit",
    organisation: "Artikel10 e.V",
    type: "Business",
  },
  location: {
    country_name: "Germany",
    latitude: 52.52,
    longitude: 13.405,
  },
  detections: {
    proxy: true,
    vpn: false,
    compromised: true,
    scraper: false,
    tor: true,
    hosting: false,
    anonymous: true,
    risk: 100,
  },
  operator: { name: "TOR", url: "https://www.torproject.org/" },
}

const unknown = {
  network: { hostname: null, provider: null, organisation: null, type: null },
  location: null,
  detections: null,
  operator: null,
}

const stop = () => new AbortController().signal

/** Their answer to a batch: a status and one result per address asked about. */
const answering = (results: Record<string, unknown>) => (ips: Array<string>) =>
  Promise.resolve({
    status: "ok",
    ...Object.fromEntries(ips.map((ip) => [ip, results[ip]])),
  } as Answer)

test("reads an address into the columns", async () => {
  const got: Array<unknown> = []
  await enrichAll(
    ["185.220.101.1"],
    ["key"],
    (one) => got.push(one),
    stop(),
    answering({ "185.220.101.1": tor })
  )

  expect(got).toEqual([
    {
      ip: "185.220.101.1",
      coordinates: "52.52, 13.405",
      // Every flag they report as true, each carrying the operator behind the
      // address. Their `anonymous` is a summary of the others and is left out.
      detections: [
        { label: "Proxy", detail: "TOR" },
        { label: "Tor", detail: "TOR" },
        { label: "Compromised", detail: "TOR" },
      ],
      asn: "Stiftung Erneuerbare Freiheit",
      type: "Business",
      company: "Artikel10 e.V",
    },
  ])
})

test("an address they know nothing about reads as empty, not as broken", async () => {
  const got: Array<unknown> = []
  await enrichAll(
    ["10.0.0.1"],
    ["key"],
    (one) => got.push(one),
    stop(),
    answering({ "10.0.0.1": unknown })
  )

  expect(got).toEqual([
    {
      ip: "10.0.0.1",
      coordinates: "",
      detections: [],
      asn: "",
      type: "",
      company: "",
    },
  ])
})

test("reports an address the answer says nothing under", async () => {
  const got: Array<unknown> = []
  await enrichAll(
    ["not-an-address"],
    ["key"],
    (one) => got.push(one),
    stop(),
    answering({})
  )

  // Nothing came back for it, and an address that neither lands nor fails sits
  // in the queue waiting for a run that has already finished.
  expect(got).toEqual([
    {
      ip: "not-an-address",
      error: "ProxyCheck said nothing about this address",
    },
  ])
})

test("asks about a hundred addresses at a time", async () => {
  const sent: Array<number> = []
  const ips = Array.from({ length: 250 }, (_, n) => `9.9.${n}.1`)
  const got: Array<unknown> = []

  await enrichAll(
    ips,
    ["key"],
    (one) => got.push(one),
    stop(),
    (some) => {
      sent.push(some.length)
      return answering(Object.fromEntries(some.map((ip) => [ip, unknown])))(
        some
      )
    }
  )

  expect(sent).toEqual([100, 100, 50])
  expect(got).toHaveLength(250)
})

test("a refused key hands its batch to the next one", async () => {
  const used: Array<string> = []
  const got: Array<unknown> = []

  await enrichAll(
    ["1.1.1.1"],
    ["spent", "good"],
    (one) => got.push(one),
    stop(),
    (some, key) => {
      used.push(key)
      return key === "spent"
        ? Promise.resolve({ status: "denied", message: "exhausted" })
        : answering({ "1.1.1.1": unknown })(some)
    }
  )

  expect(used).toEqual(["spent", "good"])
  expect(got).toHaveLength(1)
})

test("a key refused once is not put to the rest of the run", async () => {
  const used: Array<string> = []
  const ips = Array.from({ length: 250 }, (_, n) => `9.9.${n}.1`)
  let refusals = 0

  await enrichAll(
    ips,
    ["spent", "good"],
    () => {},
    stop(),
    (some, key) => {
      used.push(key)
      // Refuses the first batch only: a key that came back for the second would
      // be asked to spend an allowance this run already found empty.
      if (key === "spent" && refusals++ === 0) {
        return Promise.resolve({ status: "denied", message: "exhausted" })
      }
      return answering(Object.fromEntries(some.map((ip) => [ip, unknown])))(
        some
      )
    }
  )

  expect(used).toEqual(["spent", "good", "good", "good"])
})

test("a request that never lands hands the batch on the same way", async () => {
  const got: Array<unknown> = []

  await enrichAll(
    ["1.1.1.1"],
    ["dead", "good"],
    (one) => got.push(one),
    stop(),
    (some, key) =>
      key === "dead"
        ? Promise.reject(new Error("Failed to fetch"))
        : answering({ "1.1.1.1": unknown })(some)
  )

  expect(got).toHaveLength(1)
})

test("the run fails when the last key is refused", async () => {
  await expect(
    enrichAll(
      ["1.1.1.1"],
      ["one", "two"],
      () => {},
      stop(),
      () =>
        Promise.resolve({
          status: "denied",
          message: "1,000 Free queries exhausted.",
        })
    )
  ).rejects.toThrow(
    "All 2 ProxyCheck keys were refused, the last with: 1,000 Free queries exhausted."
  )
})

test("stops on a denied key, saying what they said", async () => {
  await expect(
    enrichAll(
      ["1.1.1.1"],
      ["key"],
      () => {},
      stop(),
      () =>
        Promise.resolve({
          status: "denied",
          message: "1,000 Free queries exhausted.",
        })
    )
  ).rejects.toThrow("1,000 Free queries exhausted.")
})

test("a pause stops before the next batch goes out", async () => {
  const stopping = new AbortController()
  const ips = Array.from({ length: 150 }, (_, n) => `9.9.${n}.1`)
  let batches = 0

  await enrichAll(
    ips,
    ["key"],
    () => {},
    stopping.signal,
    (some) => {
      batches += 1
      stopping.abort()
      return answering(Object.fromEntries(some.map((ip) => [ip, unknown])))(
        some
      )
    }
  )

  expect(batches).toBe(1)
})

/** The requests one run made. */
const requestsFrom = async () => {
  const calls: Array<[string, RequestInit]> = []
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    calls.push([url, init])
    return Promise.resolve({
      json: () => Promise.resolve({ status: "ok", "1.1.1.1": unknown }),
    })
  })

  await enrichAll(["1.1.1.1", "2.2.2.2"], ["some-key"], () => {}, stop())

  vi.unstubAllGlobals()
  return calls
}

test("sends the key and the whole batch in one request to its own server", async () => {
  const calls = await requestsFrom()

  const [url, init] = calls[0]
  expect(calls).toHaveLength(1)
  expect(url).toBe("/api/proxycheck")
  // POST, because a list of addresses in the URL is a URL as long as the list.
  expect(init.method).toBe("POST")
  expect(init.body).toBe("ips=1.1.1.1%2C2.2.2.2")
  expect(init.headers).toMatchObject({ "x-proxycheck-key": "some-key" })
})

test("a body that is not their JSON fails the run rather than the parse", async () => {
  vi.stubGlobal("fetch", () =>
    Promise.resolve({
      status: 502,
      json: () => Promise.reject(new SyntaxError("Unexpected token <")),
    })
  )

  await expect(
    enrichAll(["1.1.1.1"], ["key"], () => {}, stop())
  ).rejects.toThrow("ProxyCheck returned 502")
  vi.unstubAllGlobals()
})
