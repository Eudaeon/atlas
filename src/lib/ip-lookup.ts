import { enrichAll } from "@/lib/proxycheck"

/** One thing the address is flagged as, and who runs it: a VPN brand, a
residential proxy network, Tor. The detail is empty for an address ProxyCheck
names no operator for. */
export type Detection = { label: string; detail: string }

/** What the lookup digs up for one address. A column reads one of these. */
export type IpInfo = {
  ip: string
  coordinates: string
  detections: Array<Detection>
  asn: string
  /** What the operator is: `isp`, `hosting`, `business`. */
  type: string
  company: string
  error?: string
}

/** A spot on the globe. */
export type Place = { lat: number; lon: number }

/** How anything working over rows asks what is known about an address. The
store's own `ipInfo` in the app, and a plain map in a test. */
export type Locate = (ip: string) => IpInfo | undefined

/** Where ProxyCheck puts an address. Undefined until the lookup lands, and for
the addresses it has no place for. The coordinates ride on an `IpInfo` as the
string ProxyCheck wrote them in, because that is what goes out to a file and
comes back; this is the one place that reads them back into numbers. */
export const placeOf = (info: IpInfo | undefined): Place | undefined => {
  const [lat, lon] = (info?.coordinates ?? "").split(",").map(Number)
  // An address with no place splits into one empty string, and `Number("")` is
  // a perfectly good zero, so both halves have to be checked.
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined
}

const known = new Map<string, IpInfo>()
const asked = new Set<string>()
const listeners = new Set<() => void>()
let version = 0

/** What is known about an address, or undefined while the lookup is out. */
export const ipInfo = (ip: string) => known.get(ip)

// A plain store rather than React state: a cell reads it through
// `useSyncExternalStore`, so a result repaints the handful of mounted cells
// instead of the whole table.
export const ipInfoVersion = () => version

export const subscribeIpInfo = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** One result off the enrichment stream. It goes through the same reading as a
file does: a failed lookup arrives as an address and a message and nothing
else, and the columns map over the fields it has none of. */
export const receiveIpInfo = (info: unknown) => {
  const one = readIpInfo(info)
  if (one === undefined) return
  known.set(one.ip, one)
  version += 1
  listeners.forEach((listener) => listener())
}

/** What is known about each of these addresses, for a file being written out.
An address still out at lookup, or one that failed, has nothing worth keeping:
the file leaves it to whoever opens it. */
export const knownIps = (ips: Iterable<string>): Array<IpInfo> =>
  [...new Set(ips)]
    .map((ip) => known.get(ip))
    .filter(
      (info): info is IpInfo => info !== undefined && info.error === undefined
    )

const text = (value: unknown) => (typeof value === "string" ? value : "")

const readDetection = (found: unknown): Detection => {
  const one = found as Record<string, unknown> | null
  return { label: text(one?.label), detail: text(one?.detail) }
}

/** An entry read into something the columns can work with, whether it came off
a file or off the wire. Either can leave a field out or put the wrong shape in
it, and a column that maps over it takes the whole view down: this is what a
failed lookup did to the statistics, arriving as an address and a message with
no detections behind them. */
const readIpInfo = (info: unknown): IpInfo | undefined => {
  const one = info as Record<string, unknown> | null
  const ip = text(one?.ip)
  if (ip === "") return undefined
  const error = text(one?.error)
  return {
    ip,
    ...(error === "" ? {} : { error }),
    coordinates: text(one?.coordinates),
    detections: Array.isArray(one?.detections)
      ? one.detections.map(readDetection)
      : [],
    asn: text(one?.asn),
    type: text(one?.type),
    company: text(one?.company),
  }
}

/** What a file this app wrote already knows, put back in the store so it is
not looked up a second time. Addresses it says nothing about are left to the
queue, which is what a file exported mid-run leaves behind. */
export function seedIpInfo(infos: Array<unknown>) {
  let added = 0
  for (const info of infos) {
    const one = readIpInfo(info)
    // A file saying an address failed is worth nothing: it goes back in the
    // queue to be asked about again.
    if (one === undefined || one.error !== undefined) continue
    if (known.has(one.ip)) continue
    known.set(one.ip, one)
    asked.add(one.ip)
    added += 1
  }
  if (added === 0) return
  version += 1
  listeners.forEach((listener) => listener())
}

/** How far the run has got, and whether it is on hold. */
export type LookupProgress = {
  done: number
  total: number
  paused: boolean
  error?: string
}

const store = "proxycheck-key"

/** However the keys were typed, as a list. One per line is what the box asks
for, but a run of them pasted off a page arrives separated by anything. The same
key twice is one key: a pool holding it twice would only put a batch to a spent
allowance a second time. */
const splitKeys = (typed: string) => [
  ...new Set(typed.split(/[\s,]+/).filter((one) => one !== "")),
]

/** The ProxyCheck API keys the lookups are made with, kept in localStorage so a
reload does not ask for them again. They are secrets in cleartext: anything
running in this browser can read them, which is the price of not typing them in
every time. */
let keys = read()

/** Empty on the server, which has nothing to remember, and in a browser that
refuses localStorage. */
function read(): Array<string> {
  // A render on the server reaches node's own localStorage, which warns when
  // read without a store file.
  if (typeof window === "undefined") return []
  try {
    return splitKeys(localStorage.getItem(store) ?? "")
  } catch {
    return []
  }
}

export const proxycheckKeys = () => keys

export const hasProxycheckKey = () => keys.length > 0

/** Saves whatever was typed into the box, as the keys it holds. Doing so starts
whatever is already queued waiting for one. */
export function setProxycheckKeys(typed: string) {
  keys = splitKeys(typed)
  try {
    localStorage.setItem(store, keys.join("\n"))
  } catch {
    // Private mode, or a full quota. The keys still work for this tab.
    console.warn("Could not save the ProxyCheck keys; they last until reload")
  }
  void pump()
}

// The run is module state because it outlives any one call: an upload extends
// the queue, and the pause button reaches it from a toast.
// A set, not a list: a result takes its address out of the queue, and doing
// that with a filter walked the whole queue once per address. Insertion order
// is the order they go out in, which is all a list was giving.
const queued = new Set<string>()
let done = 0
let paused = false
let running = false
let flight: AbortController | undefined
let report: (progress: LookupProgress) => void = () => {}

const progress = (error?: string): LookupProgress => ({
  done,
  total: done + queued.size,
  paused,
  error,
})

/** Aborts the batch in flight. The addresses it had not reached stay queued
for the resume. */
export function pauseLookups() {
  paused = true
  console.info(`Lookups paused, ${queued.size} addresses left`)
  flight?.abort()
  report(progress())
}

export function resumeLookups() {
  paused = false
  console.info(`Lookups resumed, ${queued.size} addresses left`)
  report(progress())
  void pump()
}

/** Looks up every address it has not been asked about yet, and fills them in
as they land. */
export function lookupIps(
  ips: Iterable<string>,
  onProgress: (progress: LookupProgress) => void
) {
  const wanted = [...new Set(ips)].filter((ip) => ip !== "" && !asked.has(ip))
  if (wanted.length === 0) return 0
  wanted.forEach((ip) => asked.add(ip))
  wanted.forEach((ip) => queued.add(ip))
  console.info(`Queued ${wanted.length} addresses for lookup`)
  report = onProgress
  report(progress())
  void pump()
  // How many addresses this added. A file that came in already enriched adds
  // none, and then there is nothing to ask anyone for a key for.
  return wanted.length
}

// Read through a call, so the compiler does not decide it knows the answer:
// `paused` changes from a button while `pump` is waiting on a request.
const onHold = () => paused

async function pump() {
  // No key yet means the queue waits for one rather than failing, and an empty
  // queue is not a run: saving a key with no file open used to come through
  // here and announce that it had looked up nothing.
  if (running || onHold() || keys.length === 0 || queued.size === 0) {
    return
  }
  running = true
  try {
    await run()
    // A run either answers about every address it took or throws, so anything
    // still queued here was left by a pause for the resume to take.
    if (queued.size === 0) {
      console.info(`Looked up ${done} addresses`)
      done = 0
    }
  } catch (cause) {
    // A pause aborts the lookups, which is not a failure. The signal rather
    // than `paused`, because a resume can beat the rejection here: two clicks
    // in the same turn and the abort arrives with the run already running
    // again, which used to report the pause as a failed run.
    if (!onHold() && flight?.signal.aborted !== true) {
      console.error(`Enrichment failed with ${queued.size} addresses left`)
      queued.forEach((ip) => asked.delete(ip))
      queued.clear()
      done = 0
      report(progress(cause instanceof Error ? cause.message : String(cause)))
    }
  } finally {
    running = false
    // That same resume found the run busy and did nothing, and nothing else is
    // coming to start it. A run that ended any other way leaves an empty queue
    // here, so this only fires for the one it was aborted out of.
    if (!onHold() && queued.size > 0) void pump()
  }
}

/** One pass over the queue. `enrichAll` asks about a hundred addresses at a
time, and every result lands here as its batch comes back. It gets the keys as
they stand now, so a key it drops is offered again by the next run. A pause
aborts the signal, and whatever it had not reached is still queued for the
resume. */
async function run() {
  flight = new AbortController()
  await enrichAll(
    [...queued],
    keys,
    (info) => {
      receiveIpInfo(info)
      // By address, not by position: a batch answers about its addresses in
      // whatever order they sit in the answer.
      queued.delete(info.ip)
      done += 1
      report(progress())
    },
    flight.signal
  )
}
