import { Info, ShieldAlert } from "lucide-react"

import {
  type CrowdSecData,
  type CrowdSecItem,
  reputationLevel,
} from "@/lib/crowdsec"
import { formatDate, text } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type IpDetailsDialogProps = {
  ip?: string | null
  data: CrowdSecData
  open: boolean
  onOpenChange: (open: boolean) => void
}

// A labelled fact; hidden when there's nothing meaningful to show.
function Fact({ label, value }: { label: string; value: string }) {
  if (!value || value === "Unknown" || value === "—") return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm break-words">{value}</span>
    </div>
  )
}

// A titled block, rendered only when it has content.
function Section({
  title,
  children,
  show = true,
}: {
  title: string
  children: React.ReactNode
  show?: boolean
}) {
  if (!show) return null
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

// A shared 0–5 severity ramp: low values read calm (muted, then green), high
// values read alarming (amber, orange, red). One scale for every graded value in
// this panel, the score bars and the activity rings alike, so a 4 is the same
// red whether it appears as a bar or a ring. This mirrors CrowdSec's own console.
const SEVERITY_RAMP = [
  {
    bar: "bg-muted-foreground/40",
    ring: "text-muted-foreground/30",
    text: "text-muted-foreground",
  },
  {
    bar: "bg-emerald-500",
    ring: "text-emerald-500",
    text: "text-emerald-700 dark:text-emerald-400",
  },
  {
    bar: "bg-amber-500",
    ring: "text-amber-500",
    text: "text-amber-700 dark:text-amber-400",
  },
  {
    bar: "bg-orange-500",
    ring: "text-orange-500",
    text: "text-orange-700 dark:text-orange-400",
  },
  {
    bar: "bg-red-500",
    ring: "text-red-500",
    text: "text-red-600 dark:text-red-400",
  },
  {
    bar: "bg-rose-600",
    ring: "text-rose-600",
    text: "text-rose-700 dark:text-rose-400",
  },
] as const

// Place a graded value on the ramp by normalising it to 0–5 (noise is 0–10) and
// rounding to the nearest step.
function severityStep(value: number, max: number) {
  const norm =
    max <= 0 ? 0 : Math.round((Math.max(0, Math.min(max, value)) / max) * 5)
  return SEVERITY_RAMP[norm]
}

// CrowdSec grades most metrics 0–5 (noise is 0–10); render one as a labelled
// mini bar, with an info tooltip explaining what the metric measures. The bar is
// tinted by severity so the higher (more concerning) scores stand out.
function ScoreBar({
  label,
  value,
  hint,
  max = 5,
}: {
  label: string
  value?: number
  hint?: string
  max?: number
}) {
  const v = Math.max(0, Math.min(max, value ?? 0))
  const step = severityStep(v, max)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-muted-foreground">
          {label}
          {hint ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`What does ${label} mean?`}
                    className="text-muted-foreground/60 transition-colors hover:text-foreground"
                  />
                }
              >
                <Info className="size-3" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{hint}</TooltipContent>
            </Tooltip>
          ) : null}
        </span>
        <span className="tabular-nums">
          {v}/{max}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`${step.bar} h-full rounded-full`}
          style={{ width: `${(v / max) * 100}%` }}
        />
      </div>
    </div>
  )
}

// A row of badges, each tooltip-ed with its description. Used for behaviours,
// classifications, attack scenarios and MITRE techniques.
function ItemBadges({
  items,
  variant = "secondary",
}: {
  items?: CrowdSecItem[]
  variant?: "secondary" | "outline" | "destructive"
}) {
  if (!items || items.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const label = item.label || item.name
        return item.description ? (
          <Tooltip key={item.name}>
            <TooltipTrigger render={<Badge variant={variant} />}>
              {label}
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {item.description}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Badge key={item.name} variant={variant}>
            {label}
          </Badge>
        )
      })}
    </div>
  )
}

// The verbal verdict for each aggressiveness step, indexed 0–5 to line up with
// the shared SEVERITY_RAMP so the ring colour and the label always agree.
const AGGRESSIVENESS_LABELS = [
  "None",
  "Low",
  "Moderate",
  "Aggressive",
  "Very aggressive",
  "Extremely aggressive",
] as const

// CrowdSec grades aggressiveness 0–5; map it to its verbal verdict and the colour
// from the shared ramp CrowdSec's console uses for its activity rings.
function aggressivenessVerdict(value?: number): {
  label: string
  ring: string
  text: string
} {
  const v = Math.max(0, Math.min(5, Math.round(value ?? 0)))
  const step = SEVERITY_RAMP[v]
  return { label: AGGRESSIVENESS_LABELS[v], ring: step.ring, text: step.text }
}

// One activity ring: a circular gauge filled by the window's aggressiveness, with
// the time window and its verbal verdict beside it. Mirrors the per-window rings
// in CrowdSec's console.
function ActivityRing({ label, score }: { label: string; score?: number }) {
  const v = Math.max(0, Math.min(5, score ?? 0))
  const verdict = aggressivenessVerdict(score)
  const r = 13
  const c = 2 * Math.PI * r
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`text-sm font-medium ${verdict.text}`}>
          {verdict.label}
        </span>
      </div>
      <div className="relative size-9 shrink-0">
        <svg viewBox="0 0 36 36" className="size-full -rotate-90">
          <circle
            cx="18"
            cy="18"
            r={r}
            fill="none"
            strokeWidth="3.5"
            className="stroke-current text-muted-foreground/15"
          />
          <circle
            cx="18"
            cy="18"
            r={r}
            fill="none"
            strokeWidth="3.5"
            strokeLinecap="round"
            className={`stroke-current ${verdict.ring}`}
            strokeDasharray={c}
            strokeDashoffset={c * (1 - v / 5)}
          />
        </svg>
      </div>
    </div>
  )
}

// Turn a two-letter ISO country code into its flag emoji; empty for anything that
// isn't a plain A–Z pair (e.g. the synthetic "Other" bucket).
function flagEmoji(code: string): string {
  const cc = code.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(cc)) return ""
  return String.fromCodePoint(
    ...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)
  )
}

// A small vertical bar chart of the countries an IP has been seen attacking, by
// share of its observed targets. The top ten are shown individually; the rest
// fold into a muted "Other" bar.
function CountryBars({ countries }: { countries: Record<string, number> }) {
  const entries = Object.entries(countries).sort((a, b) => b[1] - a[1])
  const total = entries.reduce((sum, [, n]) => sum + n, 0)
  if (total === 0) return null

  const top = entries.slice(0, 10)
  const otherCount = entries.slice(10).reduce((sum, [, n]) => sum + n, 0)
  const bars = top.map(([code, count]) => ({ code, count, other: false }))
  if (otherCount > 0) bars.push({ code: "", count: otherCount, other: true })
  const max = Math.max(...bars.map((b) => b.count))

  // Bars are sized in fixed pixels (not a percentage of the flex row, which
  // collapses to zero with no definite parent height) and the columns are
  // bottom-aligned so the flags share a baseline and bars grow upward.
  const TRACK = 120

  return (
    <div className="flex items-end gap-1.5">
      {bars.map((bar, i) => {
        const pct = (bar.count / total) * 100
        const flag = flagEmoji(bar.code)
        return (
          <div
            key={bar.other ? `other-${i}` : bar.code}
            className="flex min-w-0 flex-1 flex-col items-center gap-1"
          >
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {pct >= 1 ? `${Math.round(pct)}%` : "<1%"}
            </span>
            {/* Neutral fill: these bars show where the IP attacks (a
                distribution), not how severe it is, so they stay out of the
                warm severity ramp the scores and rings use. */}
            <div
              className={`w-full max-w-9 rounded-t ${
                bar.other ? "bg-foreground/15" : "bg-foreground/35"
              }`}
              style={{
                height: `${Math.max(3, Math.round((bar.count / max) * TRACK))}px`,
              }}
            />
            <span className="text-base leading-none" title={bar.code}>
              {flag || "🌐"}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {bar.other ? "Other" : bar.code}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// Full CrowdSec threat intelligence for one IP. Opened from the map's details
// panel; surfaces the reputation verdict, scores, network facts, observed attack
// behaviours, CVEs, MITRE techniques, the countries the IP targets, and which
// blocklists it sits on.
export function IpDetailsDialog({
  ip,
  data,
  open,
  onOpenChange,
}: IpDetailsDialogProps) {
  const rep = reputationLevel(data)
  const scores = data.scores?.overall

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5 shrink-0" />
            <span className="scrollbar-hide overflow-x-auto whitespace-nowrap">
              {ip || "IP threat data"}
            </span>
          </DialogTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className={rep.className}>{rep.label}</Badge>
            {data.confidence && data.confidence !== "none" ? (
              <Badge variant="outline">
                {data.confidence.charAt(0).toUpperCase() +
                  data.confidence.slice(1)}{" "}
                confidence
              </Badge>
            ) : null}
            {data.proxy_or_vpn ? (
              <Badge variant="secondary">Proxy/VPN</Badge>
            ) : null}
          </div>
        </DialogHeader>

        <TooltipProvider>
          <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-2">
            <Section title="Network">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                <Fact
                  label="Autonomous system"
                  value={
                    data.as_name
                      ? data.as_num
                        ? `${data.as_name} (AS${data.as_num})`
                        : data.as_name
                      : "Unknown"
                  }
                />
                <Fact label="IP range" value={text(data.ip_range)} />
                <Fact label="Reverse DNS" value={text(data.reverse_dns)} />
              </div>
            </Section>

            <Section title="Scores" show={!!scores}>
              {/* Flex-wrap with centred rows so the shorter final row sits in
                  the middle instead of hanging off to the left. */}
              <div className="flex flex-wrap justify-center gap-x-6 gap-y-2.5">
                {[
                  {
                    label: "Threat",
                    value: scores?.threat,
                    hint: "How dangerous the IP's behaviour is, from low-risk scanning to active exploitation.",
                  },
                  {
                    label: "Trust",
                    value: scores?.trust,
                    hint: "How confident CrowdSec is that this is a real attacker, based on the age, number, and variety of reports.",
                  },
                  {
                    label: "Aggressiveness",
                    value: scores?.aggressiveness,
                    hint: "How often the IP attacks over the period.",
                  },
                  {
                    label: "Anomaly",
                    value: scores?.anomaly,
                    hint: "Device traits, such as outdated software or unusual configuration, that suggest it is compromised.",
                  },
                  {
                    label: "Noise",
                    value: data.background_noise_score ?? undefined,
                    max: 10,
                    hint: "How much of the IP's traffic is background noise, such as broad untargeted scanning.",
                  },
                ].map((score) => (
                  <div
                    key={score.label}
                    className="basis-[calc(50%-0.75rem)] sm:basis-[calc(33.333%-1rem)]"
                  >
                    <ScoreBar {...score} />
                  </div>
                ))}
              </div>
            </Section>

            <Section title="History" show={!!data.history?.first_seen}>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                <Fact
                  label="First seen"
                  value={formatDate(data.history?.first_seen ?? undefined)}
                />
                <Fact
                  label="Last seen"
                  value={formatDate(data.history?.last_seen ?? undefined)}
                />
                <Fact
                  label="Age"
                  value={
                    data.history?.days_age != null
                      ? `${data.history.days_age.toLocaleString()} days`
                      : "Unknown"
                  }
                />
              </div>
            </Section>

            <Section title="Activity" show={!!data.scores}>
              <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                <ActivityRing
                  label="Last 24 hours"
                  score={data.scores?.last_day?.aggressiveness}
                />
                <ActivityRing
                  label="Last 7 days"
                  score={data.scores?.last_week?.aggressiveness}
                />
                <ActivityRing
                  label="Last month"
                  score={data.scores?.last_month?.aggressiveness}
                />
                <ActivityRing
                  label="Overall"
                  score={data.scores?.overall?.aggressiveness}
                />
              </div>
            </Section>

            <Section
              title="Targeted countries"
              show={
                !!data.target_countries &&
                Object.keys(data.target_countries).length > 0
              }
            >
              <CountryBars countries={data.target_countries ?? {}} />
            </Section>

            {/* What the IP has been seen doing, general to specific: the
                behaviours it exhibits, the scenarios that caught it, the
                techniques and exploits behind them. */}
            <Section title="Behaviours" show={!!data.behaviors?.length}>
              <ItemBadges items={data.behaviors} variant="destructive" />
            </Section>

            <Section
              title="Attack scenarios"
              show={!!data.attack_details?.length}
            >
              <ItemBadges items={data.attack_details} />
            </Section>

            <Section
              title="MITRE ATT&CK techniques"
              show={!!data.mitre_techniques?.length}
            >
              <ItemBadges items={data.mitre_techniques} variant="outline" />
            </Section>

            <Section title="CVEs" show={!!data.cves?.length}>
              <div className="flex flex-wrap gap-1.5">
                {data.cves?.map((cve) => (
                  <Badge key={cve} variant="outline">
                    {cve}
                  </Badge>
                ))}
              </div>
            </Section>

            <Section
              title="Classifications"
              show={!!data.classifications?.classifications?.length}
            >
              <ItemBadges items={data.classifications?.classifications} />
            </Section>

            {/* Where the intel comes from, then the caveat to it, last. */}
            <Section title="Blocklists" show={!!data.references?.length}>
              <div className="flex flex-col gap-2">
                {data.references?.map((ref) => (
                  <div key={ref.name} className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      {ref.label || ref.name}
                    </span>
                    {ref.description ? (
                      <span className="text-xs text-muted-foreground">
                        {ref.description}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </Section>

            <Section
              title="False positives"
              show={!!data.classifications?.false_positives?.length}
            >
              <ItemBadges items={data.classifications?.false_positives} />
            </Section>
          </div>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  )
}
