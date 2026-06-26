// Work-stealing pool that spreads a list of batches across several API keys and
// runs them at the same time, one worker per key.
//
// Both enrichment sources (ProxyCheck and CrowdSec) accept any number of keys.
// The batches sit in one shared queue and each key's worker pulls the next batch
// when it's free, so the work divides across the keys and every key stays busy.
// Callers size the batches so there are at least as many as keys (see
// splitSize), which means a small job still fans out one batch per key rather
// than landing entirely on one.
//
// Two kinds of failure are handled differently:
//   - A rate limit or transient blip (`query` throws a plain error): the batch
//     is requeued for any free key to retry now, and the key that hit it backs
//     off before taking more work. It stays in the pool.
//   - A hard rejection — an invalid or disabled key (`query` throws a
//     FatalKeyError): that key leaves the pool for the rest of the run and its
//     batch is handed to the others.
// The run only fails outright if every key is rejected before the queue drains.

// Thrown by `query` when the key itself is bad (e.g. 401/403): the pool retires
// it rather than retrying.
export class FatalKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FatalKeyError"
  }
}

// A key the pool rejected, paired with the error that retired it, so the caller
// can report which key failed rather than just the message.
export type RejectedKey = { key: string; error: Error }

// Thrown by `drainWithKeys` when every key was rejected before the queue could
// drain. Carries each rejected key so the caller can log them all, not just the
// last one that surfaces as the message.
export class AllKeysFailedError extends Error {
  keyErrors: RejectedKey[]
  constructor(message: string, keyErrors: RejectedKey[]) {
    super(message)
    this.name = "AllKeysFailedError"
    this.keyErrors = keyErrors
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Trim a list of keys to the non-empty, de-duplicated set worth keeping.
export function cleanKeys(keys: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const key of keys) {
    const trimmed = key.trim()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      out.push(trimmed)
    }
  }
  return out
}

// Read stored keys back out. Keys are persisted one per line; the previous
// single-key string parses as a one-key list, so old saves still load.
export function parseKeys(stored: string | null | undefined): string[] {
  return stored ? cleanKeys(stored.split("\n")) : []
}

// The batch size that spreads `total` items across `keyCount` keys without
// exceeding the per-request cap: small jobs get one batch per key, large ones
// fill each request to the cap and let work-stealing balance the rest.
export function splitSize(
  total: number,
  keyCount: number,
  cap: number
): number {
  if (total <= 0 || keyCount <= 0) return cap
  return Math.max(1, Math.min(cap, Math.ceil(total / keyCount)))
}

type PoolOptions = {
  // How many times to retry a single batch on transient errors before giving up
  // on it (its items are reported back as `dropped`).
  maxAttempts?: number
  // Backoff before a rate-limited key takes more work: baseDelayMs, doubling each
  // attempt, capped at maxDelayMs (plus a little jitter).
  baseDelayMs?: number
  maxDelayMs?: number
}

type Item<B> = { batch: B; attempts: number }

// Drain `batches` across `keys`, running `query(batch, key)` with at most one
// call per key in flight. Resolves once the queue is empty, returning the
// batches that exhausted their retries (`dropped`) and any keys retired mid-run
// (`keyErrors`) — a single bad key among working ones is reported here rather
// than thrown, so the caller can log it without failing the run. Rejects (with
// the last error) only if every key is rejected outright before the queue
// drains.
export async function drainWithKeys<B>(
  batches: B[],
  keys: string[],
  query: (batch: B, key: string) => Promise<void>,
  options: PoolOptions = {}
): Promise<{ dropped: B[]; keyErrors: RejectedKey[] }> {
  const maxAttempts = options.maxAttempts ?? 5
  const baseDelay = options.baseDelayMs ?? 1000
  const maxDelay = options.maxDelayMs ?? 10000

  // A shared queue the workers pull from. shift()/push() are synchronous, and JS
  // runs one worker at a time between awaits, so no two workers take the same
  // batch.
  const queue: Item<B>[] = batches.map((batch) => ({ batch, attempts: 0 }))
  const dropped: B[] = []
  // Keys retired mid-run, surfaced to the caller so the rejected key can be
  // logged: returned on a successful drain, or carried on AllKeysFailedError when
  // every key is rejected.
  const keyErrors: RejectedKey[] = []
  let lastError: unknown = null
  // Workers currently mid-request. A request can fail and requeue its batch, so
  // an idle worker must not give up while any are still in flight — otherwise a
  // spare key (more keys than batches) leaves before it can cover a key that
  // later hits a rate limit.
  let inFlight = 0

  await Promise.all(
    keys.map(async (key) => {
      for (;;) {
        const item = queue.shift()
        if (item === undefined) {
          if (inFlight === 0) return
          // Work may yet reappear from a failing request: wait and re-check.
          await sleep(50)
          continue
        }

        inFlight += 1
        let error: unknown = null
        try {
          await query(item.batch, key)
        } catch (err) {
          error = err
        }
        inFlight -= 1
        if (!error) continue

        lastError = error
        if (error instanceof FatalKeyError) {
          // The key is rejected outright: hand the work back for the other keys
          // and retire this worker.
          keyErrors.push({ key, error })
          queue.push(item)
          return
        }
        // Transient (rate limit, network blip). Give up on the batch once it has
        // used up its retries so the run can finish.
        item.attempts += 1
        if (item.attempts >= maxAttempts) {
          dropped.push(item.batch)
          continue
        }
        // Requeue so any free key can retry it now, then cool this key down
        // before it takes more work.
        queue.push(item)
        const delay = Math.min(maxDelay, baseDelay * 2 ** (item.attempts - 1))
        await sleep(delay + Math.random() * 250)
      }
    })
  )

  if (queue.length > 0) {
    const message =
      lastError instanceof Error ? lastError.message : "All API keys failed."
    throw new AllKeysFailedError(message, keyErrors)
  }
  return { dropped, keyErrors }
}
