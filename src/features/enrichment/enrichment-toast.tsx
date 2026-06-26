/* eslint-disable react-refresh/only-export-components --
   This module exposes imperative toast helpers that render JSX into Sonner, not
   components participating in Fast Refresh boundaries. */
import { CircleCheck, Globe, ShieldAlert, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { quantity } from "@/lib/format"

// Enrichment runs in the background once a file is loaded, so its progress lives
// in a persistent bottom-right toast per provider rather than a blocking dialog.
// Each toast carries a progress ring counting X/Y IPs while the provider works,
// then swaps to that provider's stats and auto-dismisses after 10s.

type Provider = "proxycheck" | "crowdsec"

const PROVIDERS: Record<
  Provider,
  { id: string; label: string; icon: typeof Globe }
> = {
  proxycheck: { id: "enrich:proxycheck", label: "ProxyCheck", icon: Globe },
  crowdsec: { id: "enrich:crowdsec", label: "CrowdSec", icon: ShieldAlert },
}

const DONE_DURATION = 10_000

// A circular X/Y progress indicator. Stroke uses currentColor so the arc picks
// up text-primary and the track a faint muted tone.
function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 15
  const circumference = 2 * Math.PI * r
  const pct = total > 0 ? Math.min(done / total, 1) : 0
  return (
    <div className="relative size-10 shrink-0">
      <svg viewBox="0 0 36 36" className="size-full -rotate-90">
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          strokeWidth="3"
          className="stroke-current text-muted-foreground/20"
        />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          className="stroke-current text-primary transition-[stroke-dashoffset] duration-300"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
        />
      </svg>
    </div>
  )
}

// The toast shell, styled to match the app's popover/toast look since the custom
// toast is rendered unstyled (no default Sonner chrome).
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-[22rem] items-center gap-3 rounded-2xl bg-popover p-3 text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10">
      {children}
    </div>
  )
}

function ProviderName({ provider }: { provider: Provider }) {
  const { label, icon: Icon } = PROVIDERS[provider]
  return (
    <span className="flex items-center gap-1.5 text-sm font-medium">
      <Icon className="size-3.5" />
      {label}
    </span>
  )
}

// Show or update a provider's progress toast. Stays up indefinitely until the
// provider finishes, fails, or is dismissed.
export function enrichmentProgress(
  provider: Provider,
  done: number,
  total: number
) {
  const { id } = PROVIDERS[provider]
  toast.custom(
    () => (
      <Card>
        <ProgressRing done={done} total={total} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <ProviderName provider={provider} />
          <span className="text-xs text-muted-foreground">
            Enriching IPs · {done.toLocaleString()}/{total.toLocaleString()}
          </span>
        </div>
      </Card>
    ),
    { id, duration: Infinity, unstyled: true }
  )
}

// Swap a provider's toast to a completed state with its stats, auto-dismissing
// after 10s.
function finish(provider: Provider, stats: React.ReactNode) {
  const { id } = PROVIDERS[provider]
  toast.custom(
    () => (
      <Card>
        <CircleCheck className="size-8 shrink-0 text-emerald-600 dark:text-emerald-500" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <ProviderName provider={provider} />
          {stats}
        </div>
      </Card>
    ),
    { id, duration: DONE_DURATION, unstyled: true }
  )
}

// ProxyCheck finished: a plain count of the IPs looked up.
export function finishProxyCheck(requested: number) {
  finish(
    "proxycheck",
    <span className="text-xs text-muted-foreground">
      Enriched {quantity(requested, "IP")}.
    </span>
  )
}

// CrowdSec finished: a plain count of the IPs looked up, matching ProxyCheck.
export function finishCrowdSec(requested: number) {
  finish(
    "crowdsec",
    <span className="text-xs text-muted-foreground">
      Enriched {quantity(requested, "IP")}.
    </span>
  )
}

// Replace a provider's toast with an error, dismissable like a normal toast.
export function failEnrichment(provider: Provider, message: string) {
  const { id } = PROVIDERS[provider]
  toast.custom(
    () => (
      <Card>
        <TriangleAlert className="size-8 shrink-0 text-destructive" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <ProviderName provider={provider} />
          <span className="text-xs text-pretty text-muted-foreground">
            {message}
          </span>
        </div>
      </Card>
    ),
    { id, duration: 8000, unstyled: true }
  )
}

// Remove a provider's toast outright (e.g. CrowdSec with no key configured).
export function dismissEnrichment(provider: Provider) {
  toast.dismiss(PROVIDERS[provider].id)
}
