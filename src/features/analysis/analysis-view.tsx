import { useMemo, useState } from "react"
import {
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Clock,
  Info,
  MapPinned,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { analyze, type Finding, type Severity } from "@/lib/analysis"
import type { SignIn } from "@/lib/signin"
import type { EnrichmentMap } from "@/lib/proxycheck"
import type { CrowdSecMap } from "@/lib/crowdsec"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { ViewContainer, ViewHeader } from "@/features/app-shell/view-container"
import { quantity } from "@/lib/format"

type AnalysisViewProps = {
  rows: SignIn[]
  enrichment: EnrichmentMap
  crowdsec: CrowdSecMap
  // Maps a user label to its colour, shared with the map so dots match.
  colorFor: (user: string) => string
  // Focus the map on a finding's connections and switch to the map view.
  onViewOnMap: (rows: SignIn[]) => void
}

// Per-severity presentation: the icon and its colour, the small dot used in the
// filter bar, and how the Badge that labels the finding is styled. Tone is
// carried by these small tinted accents, matching the rest of the app (badges,
// status dots) rather than a loud full-height accent rail.
const SEVERITY: Record<
  Severity,
  {
    label: string
    icon: typeof ShieldAlert
    iconClass: string
    dotClass: string
    badgeVariant: "destructive" | "secondary"
    badgeClass?: string
  }
> = {
  high: {
    label: "High",
    icon: ShieldAlert,
    iconClass: "text-destructive",
    dotClass: "bg-destructive",
    badgeVariant: "destructive",
  },
  medium: {
    label: "Medium",
    icon: TriangleAlert,
    iconClass: "text-amber-600 dark:text-amber-500",
    dotClass: "bg-amber-500",
    badgeVariant: "secondary",
    badgeClass: "bg-amber-500/10 text-amber-600 dark:text-amber-500",
  },
  low: {
    label: "Low",
    icon: Info,
    iconClass: "text-primary",
    dotClass: "bg-primary",
    badgeVariant: "secondary",
    badgeClass: "bg-primary/10 text-primary",
  },
  info: {
    label: "Info",
    icon: Info,
    iconClass: "text-muted-foreground",
    dotClass: "bg-muted-foreground",
    badgeVariant: "secondary",
  },
}

// Highest-severity first, the order findings and filter pills are shown in.
const SEVERITY_ORDER: Severity[] = ["high", "medium", "low", "info"]

// How many detail lines a finding shows before collapsing the rest behind a
// "Show more" toggle, so findings with many offenders (e.g. every account with
// an MFA gap) don't grow into a wall of text.
const DETAIL_CAP = 6

// The span of time the affected sign-ins cover, for triage ("when did this
// happen"). Null when none of the rows carry a usable date.
function timeRange(rows: SignIn[]): string | null {
  let min = Infinity
  let max = -Infinity
  for (const row of rows) {
    if (!row.createdDateTime) continue
    const t = new Date(row.createdDateTime).getTime()
    if (Number.isNaN(t)) continue
    if (t < min) min = t
    if (t > max) max = t
  }
  if (!Number.isFinite(min)) return null
  const fmt = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  const from = fmt(min)
  const to = fmt(max)
  return from === to ? from : `${from} – ${to}`
}

// A single severity tab in the filter bar: a colour dot, label and count that
// toggles the list to that severity (or back to all).
function FilterPill({
  label,
  count,
  active,
  onClick,
  dotClass,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  dotClass?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-border bg-muted text-foreground"
          : "border-transparent text-muted-foreground hover:bg-muted/50"
      )}
    >
      {dotClass ? (
        <span className={cn("size-1.5 rounded-full", dotClass)} />
      ) : null}
      {label}
      <span className="text-muted-foreground/80 tabular-nums">{count}</span>
    </button>
  )
}

function FindingCard({
  finding,
  colorFor,
  onViewOnMap,
}: {
  finding: Finding
  colorFor: (user: string) => string
  onViewOnMap: (rows: SignIn[]) => void
}) {
  const meta = SEVERITY[finding.severity]
  const Icon = meta.icon
  const count = finding.rows.length
  const range = useMemo(() => timeRange(finding.rows), [finding.rows])
  const [expanded, setExpanded] = useState(false)

  const details =
    expanded || finding.details.length <= DETAIL_CAP
      ? finding.details
      : finding.details.slice(0, DETAIL_CAP)
  const hidden = finding.details.length - details.length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          {/* The icon's colour carries the severity; the badge labels it. */}
          <Icon className={cn("size-4 shrink-0", meta.iconClass)} />
          {finding.title}
        </CardTitle>
        <CardAction>
          <Badge variant={meta.badgeVariant} className={meta.badgeClass}>
            {meta.label}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <CardDescription className="text-pretty">
          {finding.description}
        </CardDescription>
        <ul className="flex flex-col gap-1 border-t pt-3">
          {details.map((detail, i) => (
            <li key={i} className="flex items-center gap-2">
              {detail.user ? (
                <span
                  className="size-2.5 shrink-0 rounded-full ring-1 ring-black/10"
                  style={{ backgroundColor: colorFor(detail.user) }}
                />
              ) : null}
              <span className="scrollbar-hide min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-nowrap text-foreground/90">
                {detail.text}
              </span>
              {/* Sign-in count as a trailing badge, like the map's per-user
                  count, instead of being spelled out in the line. */}
              {detail.count != null ? (
                <Badge variant="secondary" className="shrink-0 tabular-nums">
                  {detail.count}
                </Badge>
              ) : null}
            </li>
          ))}
          {finding.details.length > DETAIL_CAP ? (
            <li className="mt-0.5">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {expanded ? (
                  <>
                    <ChevronUp className="size-3.5" /> Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="size-3.5" /> Show {hidden} more
                  </>
                )}
              </button>
            </li>
          ) : null}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {count > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onViewOnMap(finding.rows)}
            >
              <MapPinned />
              View {quantity(count, "connection")} on the map
            </Button>
          ) : (
            <span />
          )}
          {range ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5 shrink-0" />
              {range}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

// SOC-analyst dashboard over the loaded sign-ins: prioritised security findings,
// each with the offending users/IPs and a jump to see those connections on the
// map. Reads the full loaded dataset and its IP enrichment; geo/risk findings
// only appear once enrichment is available.
export function AnalysisView({
  rows,
  enrichment,
  crowdsec,
  colorFor,
  onViewOnMap,
}: AnalysisViewProps) {
  const findings = useMemo(
    () => analyze(rows, enrichment, crowdsec),
    [rows, enrichment, crowdsec]
  )
  const [filter, setFilter] = useState<Severity | "all">("all")

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 }
    for (const f of findings) c[f.severity]++
    return c
  }, [findings])

  // Fall back to "all" if the chosen severity no longer has any findings (e.g.
  // after loading a new dataset), so the list is never mysteriously empty.
  const active = filter !== "all" && counts[filter] === 0 ? "all" : filter
  const visible =
    active === "all" ? findings : findings.filter((f) => f.severity === active)

  if (findings.length === 0) {
    return (
      <ViewContainer>
        <ViewHeader title="Analysis" />
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia
              variant="icon"
              className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-500"
            >
              <CircleCheck />
            </EmptyMedia>
            <EmptyTitle>No findings</EmptyTitle>
            <EmptyDescription>
              No anonymising infrastructure, impossible travel, spray patterns,
              or MFA gaps in this dataset.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ViewContainer>
    )
  }

  return (
    <ViewContainer>
      <ViewHeader title="Analysis">
        {/* Severity overview that doubles as a filter: counts at a glance, one
            click to narrow the list to a single severity. */}
        <div className="flex flex-wrap items-center gap-1">
          <FilterPill
            label="All"
            count={findings.length}
            active={active === "all"}
            onClick={() => setFilter("all")}
          />
          {SEVERITY_ORDER.map((sev) =>
            counts[sev] > 0 ? (
              <FilterPill
                key={sev}
                label={SEVERITY[sev].label}
                count={counts[sev]}
                dotClass={SEVERITY[sev].dotClass}
                active={active === sev}
                onClick={() => setFilter(sev)}
              />
            ) : null
          )}
        </div>
      </ViewHeader>

      <div className="flex flex-col gap-4">
        {visible.map((finding) => (
          <FindingCard
            key={finding.id}
            finding={finding}
            colorFor={colorFor}
            onViewOnMap={onViewOnMap}
          />
        ))}
      </div>
    </ViewContainer>
  )
}
