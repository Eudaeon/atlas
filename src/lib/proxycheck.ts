import type { IpInfo } from "@/lib/ip-lookup"

/** Addresses per request. Their cap is 100 without a key and 1,000 with one,
and every address in a batch counts against the daily allowance the same as it
would on its own. Short batches only cost a few more requests, and they put the
first results on the table sooner. */
const batchSize = 100

/** The detections ProxyCheck answers with, and what the column calls each one.
Their `anonymous` is left out: it is true whenever any of these are, so a column
carrying it would say the same thing twice. */
const flags: Array<[string, string]> = [
  ["proxy", "Proxy"],
  ["vpn", "VPN"],
  ["tor", "Tor"],
  ["scraper", "Scraper"],
  ["compromised", "Compromised"],
  ["hosting", "Hosting"],
]

/** One address as their v3 API answers about it. Every key is always there,
and the ones they have nothing for come back null rather than missing. */
type Result = {
  network?: {
    provider?: string | null
    organisation?: string | null
    type?: string | null
  } | null
  location?: { latitude?: number | null; longitude?: number | null } | null
  detections?: Record<string, unknown> | null
  operator?: { name?: string | null } | null
}

/** A whole answer: a status, and a result under each address that was asked
about. */
export type Answer = {
  status?: string
  message?: string
  [address: string]: unknown
}

const text = (value: unknown) => (typeof value === "string" ? value : "")

const readOne = (ip: string, found: Result): IpInfo => {
  const place = found.location ?? {}
  const detected = found.detections ?? {}
  // Who runs the address: a VPN brand, a residential proxy network, Tor. One
  // address has one operator, so it goes against each of its detections.
  const operator = text(found.operator?.name)
  const positive = flags.filter(([key]) => detected[key] === true)

  return {
    ip,
    coordinates:
      typeof place.latitude === "number"
        ? `${place.latitude}, ${place.longitude}`
        : "",
    detections: positive.map(([, label]) => ({ label, detail: operator })),
    asn: text(found.network?.provider),
    type: text(found.network?.type),
    company: text(found.network?.organisation),
  }
}

const form = { "content-type": "application/x-www-form-urlencoded" }

/** How a batch is asked about, so a test can answer without a network. */
export type Ask = (
  ips: Array<string>,
  key: string,
  stop: AbortSignal
) => Promise<Answer>

/** One request, however many addresses. They take the list as POST data and
answer with an object keyed by address, so a batch comes back whole. */
const ask: Ask = async (ips, key, stop) => {
  const response = await fetch("/api/proxycheck", {
    method: "POST",
    // The key goes in a header, not in the query, which is the half of a
    // request that gets logged.
    headers: { ...form, "x-proxycheck-key": key },
    body: new URLSearchParams({ ips: ips.join(",") }).toString(),
    signal: stop,
  })
  // A refused request answers with JSON and a message saying why, under a 4xx.
  // Anything else that comes back did not come from their API.
  return (await response.json().catch(() => ({
    status: "error",
    message: `ProxyCheck returned ${response.status}`,
  }))) as Answer
}

/** One batch, put to the keys still in the pool until one of them answers for
it. A key that fails hands the batch straight back and takes no further part in
the run: what a key is refused for is the day's allowance spent, or a key that
was never a key, and neither of those comes right on the next batch. Undefined
where the run was aborted part way through a request. */
const resolve = async (
  some: Array<string>,
  pool: Array<string>,
  stop: AbortSignal,
  batch: Ask
): Promise<Answer | undefined> => {
  const keys = pool.length
  let refused = ""
  while (pool.length > 0) {
    const answer = await batch(some, pool[0], stop).catch((cause: unknown) => {
      if (stop.aborted) return undefined
      // A request that never landed is the key's turn wasted the same as a
      // refusal is, and it hands the batch on the same way.
      return {
        status: "error",
        message: cause instanceof Error ? cause.message : String(cause),
      } satisfies Answer
    })
    if (answer === undefined) return undefined
    const status = text(answer.status)
    if (status !== "denied" && status !== "error") return answer
    refused = text(answer.message) || "the request was refused"
    // By its place in the list, never the key itself: this goes to a console
    // anyone at the machine can open.
    console.warn(
      `ProxyCheck key ${keys - pool.length + 1} of ${keys} dropped for the rest of this run: ${refused}`
    )
    pool.shift()
  }
  // Nothing was refused because there was nothing to refuse it.
  if (refused === "") throw new Error("There is no ProxyCheck key to ask with")
  throw new Error(
    keys === 1
      ? refused
      : `All ${keys} ProxyCheck keys were refused, the last with: ${refused}`
  )
}

/** Looks the queue up a batch at a time, reporting each address as its batch
lands. The keys work as a pool, one batch at a time: whichever is at the front
of it answers, and one that cannot hands the batch to the next. The run fails
when the last key does. The pool is this run's, so a key dropped from it is back
for the next one, which is what a fresh day's allowance needs. A pause aborts the
request in flight and leaves the rest of the list alone. */
export async function enrichAll(
  ips: Array<string>,
  keys: Array<string>,
  send: (result: IpInfo | { ip: string; error: string }) => void,
  stop: AbortSignal,
  batch: Ask = ask
) {
  const pool = [...keys]
  for (let at = 0; at < ips.length; at += batchSize) {
    if (stop.aborted) return
    const some = ips.slice(at, at + batchSize)
    const answer = await resolve(some, pool, stop, batch)
    if (answer === undefined) return
    const message = text(answer.message)
    // Their warnings are about the account rather than the addresses: the
    // daily allowance running down, a burst token spent. The results are good.
    if (message !== "") console.warn(`ProxyCheck: ${message}`)

    let flagged = 0
    for (const ip of some) {
      const found = answer[ip]
      // Nothing under the address means it is not one they read as an address.
      // Reported rather than passed over, because an address that neither
      // lands nor fails sits in the queue for a run that never comes back.
      if (found === null || typeof found !== "object") {
        send({ ip, error: "ProxyCheck said nothing about this address" })
        continue
      }
      const one = readOne(ip, found)
      if (one.detections.length > 0) flagged += 1
      send(one)
    }
    // A line a batch, not a line an address: a console keeps every one of them,
    // and a run over twenty thousand addresses was twenty thousand lines.
    console.info(`ProxyCheck: ${some.length} addresses, ${flagged} flagged`)
  }
}
