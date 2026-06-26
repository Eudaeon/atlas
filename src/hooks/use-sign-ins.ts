import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { enrichIps, type EnrichmentMap } from "@/lib/proxycheck"
import { enrichCrowdSec, type CrowdSecMap } from "@/lib/crowdsec"
import {
  enrichmentProgress,
  failEnrichment,
  finishCrowdSec,
  finishProxyCheck,
} from "@/features/enrichment/enrichment-toast"
import { coerceSignIns, type SignIn } from "@/lib/signin"
import { AllKeysFailedError, type RejectedKey } from "@/lib/key-pool"
import { quantity } from "@/lib/format"
import type { SharePayload } from "@/lib/share"

// Warn the console about each key a provider rejected during enrichment, naming
// the key so the user can tell which one failed. Invalid keys are always logged
// here; the toast is reserved for when every key failed.
function logKeyErrors(provider: string, keyErrors: RejectedKey[]) {
  for (const { key, error } of keyErrors) {
    const label = key || "(keyless)"
    console.warn(`${provider} key ${label} rejected:`, error.message)
  }
}

// Owns the loaded sign-ins and their IP enrichment. Parsing is the only blocking
// step (the status dialog reflects it); once parsed, the app is usable and the
// two enrichment sources run in the background — ProxyCheck (geolocation +
// network type) and CrowdSec (the risk picture) — each reporting into its own
// persistent progress toast. Each source can hold any number of keys: its work
// is spread across them at once and a spent key drops out of that run (see
// lib/key-pool). The view layer reads `rows`/`enrichment`/`crowdsec` and drives
// everything through `loadFile`, `applyShared`, and `reEnrich`.
export function useSignIns(apiKeys: string[], crowdsecKeys: string[]) {
  const [rows, setRows] = useState<SignIn[] | null>(null)
  const [enrichment, setEnrichment] = useState<EnrichmentMap>({})
  const [crowdsec, setCrowdsec] = useState<CrowdSecMap>({})
  const [parsing, setParsing] = useState(false)
  // Set when the uploaded file can't be parsed: a hard error with no data behind
  // it.
  const [error, setError] = useState<string | null>(null)

  // Read by the stable callbacks below so they don't need to be recreated (and
  // re-bind every consumer) whenever the keys change.
  const apiKeysRef = useRef(apiKeys)
  useEffect(() => {
    apiKeysRef.current = apiKeys
  }, [apiKeys])
  const crowdsecKeysRef = useRef(crowdsecKeys)
  useEffect(() => {
    crowdsecKeysRef.current = crowdsecKeys
  }, [crowdsecKeys])

  // ProxyCheck enrichment: geolocation + network type. Reports into its progress
  // toast, then swaps it to a count of the IPs looked up. Only an all-keys
  // failure is shown on the toast; a single rejected key (the others covered for
  // it) is logged to the console. Nothing throws — the app stays usable on
  // whatever resolved.
  const runProxyCheck = useCallback(async (ips: string[], keys: string[]) => {
    enrichmentProgress("proxycheck", 0, ips.length)
    try {
      const result = await enrichIps(ips, keys, (done) =>
        enrichmentProgress("proxycheck", done, ips.length)
      )
      // Merge rather than replace, so enrichment carried in from a share (or a
      // previous run) is kept alongside the newly looked-up IPs.
      setEnrichment((prev) => ({ ...prev, ...result.map }))
      // Always log keys rejected mid-run. While other keys covered for them the
      // run still succeeded, so this stays in the console rather than a toast.
      logKeyErrors("ProxyCheck", result.keyErrors)
      // Nothing came back at all (every key was rejected or rate-limited until
      // its retries ran out): surface it as an error, not a "0 enriched" success.
      if (result.requested === 0) {
        failEnrichment(
          "proxycheck",
          "Couldn't look up any IPs. Every ProxyCheck key was rejected or out of quota."
        )
        return
      }
      // IPs skipped over the rate limit are a partial problem — log them rather
      // than interrupting with a toast.
      if (result.skipped > 0) {
        console.warn(
          `ProxyCheck enriched ${result.requested} IPs, skipped ${result.skipped} over the rate limit.`
        )
      }
      finishProxyCheck(result.requested)
    } catch (err) {
      // Every key was rejected before any data came back. Log each invalid key,
      // then surface the failure on the toast.
      if (err instanceof AllKeysFailedError) {
        logKeyErrors("ProxyCheck", err.keyErrors)
      }
      failEnrichment(
        "proxycheck",
        err instanceof Error
          ? err.message
          : "Couldn't look up IP details. The map and table show the data without enrichment."
      )
    }
  }, [])

  // CrowdSec enrichment: the risk picture. Only run when a key is set (the caller
  // gates on it), since a keyless lookup can't succeed. CrowdSec is optional, so
  // nothing throws: only an all-keys failure surfaces on its toast (a single
  // rejected key is logged to the console), and the map and table still work on
  // the ProxyCheck data alone.
  const runCrowdSec = useCallback(async (ips: string[], keys: string[]) => {
    enrichmentProgress("crowdsec", 0, ips.length)
    try {
      const result = await enrichCrowdSec(ips, keys, (done) =>
        enrichmentProgress("crowdsec", done, ips.length)
      )
      setCrowdsec((prev) => ({ ...prev, ...result.map }))
      // Always log keys rejected mid-run. While other keys covered for them the
      // run still succeeded, so this stays in the console rather than a toast.
      logKeyErrors("CrowdSec", result.keyErrors)
      // Nothing came back at all (every key was rejected or rate-limited until
      // its retries ran out): surface it as an error, not a "0 enriched" success.
      if (result.requested === 0) {
        failEnrichment(
          "crowdsec",
          "Couldn't look up any IPs. Every CrowdSec key was rejected or out of quota."
        )
        return
      }
      // IPs skipped over the quota are a partial problem — log them rather than
      // interrupting with a toast.
      if (result.skipped > 0) {
        console.warn(
          `CrowdSec looked up ${result.requested} IPs, skipped ${result.skipped} over the quota.`
        )
      }
      finishCrowdSec(result.requested)
    } catch (err) {
      // Every key was rejected before any data came back. Log each invalid key,
      // then surface the failure on the toast.
      if (err instanceof AllKeysFailedError) {
        logKeyErrors("CrowdSec", err.keyErrors)
      }
      failEnrichment(
        "crowdsec",
        err instanceof Error
          ? err.message
          : "Couldn't look up CrowdSec risk data."
      )
    }
  }, [])

  const runEnrichment = useCallback(
    async (
      signIns: SignIn[],
      keys: string[],
      crowdsecKeysArg: string[],
      existing: EnrichmentMap = {},
      existingCrowdSec: CrowdSecMap = {}
    ) => {
      // Only look up IPs we don't already have data for, per source. This skips
      // the work entirely when opening a shared link that already carried its
      // enrichment, and otherwise fills in just the gaps. The sources run one
      // after the other, each reporting into its own toast.
      const allIps = Array.from(
        new Set(
          signIns.map((row) => row.ipAddress).filter((ip): ip is string => !!ip)
        )
      )
      const proxyIps = allIps.filter((ip) => !existing[ip])
      const crowdsecIps = allIps.filter((ip) => !existingCrowdSec[ip])

      // Each source only runs when it has a key: without one the lookup can't
      // succeed, so we skip it rather than fire a request that just fails. Adding
      // a key later re-triggers this through `reEnrich`, filling the gap then.
      // ProxyCheck runs first and fully completes before CrowdSec starts, so the
      // two don't contend for bandwidth and the geolocation lands before the risk
      // data layered on top of it.
      if (proxyIps.length && keys.length) {
        await runProxyCheck(proxyIps, keys)
      }
      if (crowdsecIps.length && crowdsecKeysArg.length) {
        await runCrowdSec(crowdsecIps, crowdsecKeysArg)
      }
    },
    [runProxyCheck, runCrowdSec]
  )

  // Read, parse and enrich an uploaded file. Entra exports its sign-in log as
  // JSON; Purview exports the unified audit log as CSV with the sign-in detail
  // nested in each row's AuditData column. The CSV parser is loaded on demand to
  // keep its large app-name map out of the initial bundle.
  const loadFile = useCallback(
    (file: File) => {
      const isCsv =
        file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv"

      setParsing(true)
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const text = reader.result as string
          const parsed = isCsv
            ? (await import("@/lib/purview")).coercePurviewCsv(text)
            : coerceSignIns(JSON.parse(text))
          // No parse, or a valid-looking export whose every entry was dropped for
          // a malformed IP (nothing left to show): treat as a hard load failure,
          // the same as an unrecognised file.
          if (!parsed || parsed.rows.length === 0) {
            throw new Error("Not a sign-in export.")
          }
          const data = parsed.rows
          setRows(data)
          setError(null)
          setEnrichment({})
          setCrowdsec({})
          setParsing(false)
          // Some entries loaded but others were dropped for a malformed IP — note
          // how many, since they silently won't appear in any view.
          if (parsed.dropped > 0) {
            toast.warning(
              `Dropped ${quantity(parsed.dropped, "entry", "entries")} with an invalid IP address.`
            )
          }
          // Enrich automatically (and non-blockingly) as soon as data is loaded.
          runEnrichment(data, apiKeysRef.current, crowdsecKeysRef.current)
        } catch {
          setError("This file isn't a sign-in export.")
          setRows(null)
          setParsing(false)
        }
      }
      reader.onerror = () => {
        setError("This file couldn't be read. Try again.")
        setParsing(false)
      }
      reader.readAsText(file)
    },
    [runEnrichment]
  )

  // Adopt a shared payload as if it were an upload, restoring the bundled
  // enrichment and only looking up IPs it didn't already cover.
  const applyShared = useCallback(
    ({
      rows: shared,
      enrichment: sharedEnrichment,
      crowdsec: sharedCrowdSec = {},
    }: SharePayload) => {
      setRows(shared)
      setEnrichment(sharedEnrichment)
      setCrowdsec(sharedCrowdSec)
      setError(null)
      runEnrichment(
        shared,
        apiKeysRef.current,
        crowdsecKeysRef.current,
        sharedEnrichment,
        sharedCrowdSec
      )
    },
    [runEnrichment]
  )

  // Look up any IPs still missing enrichment with new keys (e.g. ones a keyless
  // run skipped, or a CrowdSec key added after the fact), without redoing IPs
  // already enriched by each source.
  const reEnrich = useCallback(
    (keys: string[], csKeys: string[]) => {
      if (rows) runEnrichment(rows, keys, csKeys, enrichment, crowdsec)
    },
    [rows, enrichment, crowdsec, runEnrichment]
  )

  return {
    rows,
    enrichment,
    crowdsec,
    parsing,
    error,
    loadFile,
    applyShared,
    reEnrich,
    dismissError: useCallback(() => setError(null), []),
  }
}
