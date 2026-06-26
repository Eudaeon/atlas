import { useMemo, useState } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts"

import { computeStatistics, type NamedCount } from "@/lib/statistics"
import { quantity } from "@/lib/format"
import type { SignIn } from "@/lib/signin"
import type { EnrichmentMap } from "@/lib/proxycheck"
import type { CrowdSecMap } from "@/lib/crowdsec"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  buildFilterOptions,
  filterRows,
  NO_FILTERS,
  type StatFilters,
} from "@/lib/statistics-filters"
import { StatisticsFilters } from "@/features/statistics/statistics-filters"
import { ViewContainer, ViewHeader } from "@/features/app-shell/view-container"

type StatisticsViewProps = {
  rows: SignIn[]
  enrichment: EnrichmentMap
  crowdsec: CrowdSecMap
}

function StatCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {/* Grow to fill the card and centre the chart vertically, so when two
          cards share a grid row the shorter one's content sits centred in the
          taller one's height instead of clinging to the top. */}
      <CardContent className="flex flex-1 flex-col justify-center">
        {children}
      </CardContent>
    </Card>
  )
}

// A horizontal recharts bar chart of the top categories by count. The category
// labels are NOT drawn by recharts (SVG text can't scroll, and an HTML
// foreignObject won't scroll in Chrome). Instead the chart's axis labels are
// hidden and the names are rendered as a real HTML column on the left, one row
// per bar, each overflowing with an invisible horizontal scrollbar. The column
// uses equal flex rows so it lines up with recharts' evenly-spaced bands (chart
// top/bottom margins are zeroed so the plot area fills the same height).
function BarCard({
  title,
  description,
  data,
}: {
  title: string
  description: string
  data: NamedCount[]
}) {
  const config = {
    count: { label: "Sign-ins", color: "var(--chart-2)" },
  } satisfies ChartConfig
  const height = Math.max(data.length * 34 + 16, 120)
  return (
    <StatCard title={title} description={description}>
      <div className="flex w-full gap-2" style={{ height }}>
        <div className="flex w-28 shrink-0 flex-col">
          {data.map((d) => (
            <div
              key={d.name}
              className="flex min-h-0 flex-1 items-center justify-end"
            >
              <span
                title={d.name}
                className="scrollbar-hide max-w-full overflow-x-auto py-0.5 text-right text-xs whitespace-nowrap text-muted-foreground"
              >
                {d.name}
              </span>
            </div>
          ))}
        </div>
        <ChartContainer
          config={config}
          style={{ height }}
          className="min-w-0 flex-1"
        >
          <BarChart
            accessibilityLayer
            data={data}
            layout="vertical"
            margin={{ top: 0, bottom: 0, left: 0, right: 16 }}
          >
            <CartesianGrid horizontal={false} />
            <XAxis type="number" dataKey="count" hide />
            <YAxis type="category" dataKey="name" width={0} hide />
            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
            <Bar dataKey="count" fill="var(--color-count)" radius={4} />
          </BarChart>
        </ChartContainer>
      </div>
    </StatCard>
  )
}

// Named hues for the categorical charts, defined once so the semantic uses
// (success green, single-factor orange) and the donut palette all draw from the
// same values rather than repeating raw oklch literals.
const HUE = {
  blue: "oklch(0.62 0.19 255)",
  orange: "oklch(0.70 0.18 45)",
  green: "oklch(0.68 0.17 150)",
  red: "oklch(0.60 0.22 20)",
  purple: "oklch(0.58 0.20 300)",
  teal: "oklch(0.72 0.13 195)",
  yellow: "oklch(0.78 0.16 90)",
  pink: "oklch(0.65 0.20 350)",
} as const

// Semantic outcome colours, shared by the timeline and the Outcome donut so
// success/failure read the same everywhere: green for success, red for failure.
const SUCCESS_COLOR = HUE.green
const FAILURE_COLOR = "var(--destructive)"

// A categorical palette of visually distinct hues for donut slices. The theme's
// --chart-1..5 ramp is a single zinc scale whose steps are too close to tell
// apart in a pie, so these are spread across the colour wheel instead.
// --chart-2 is intentionally excluded: it is reserved for the single-colour bar
// charts, and the multi-colour charts use a completely different set.
const CHART_COLORS = [
  HUE.blue,
  HUE.orange,
  HUE.green,
  HUE.red,
  HUE.purple,
  HUE.teal,
  HUE.yellow,
  HUE.pink,
]

// A donut chart for a set of named slices. Pass `colors` to fix specific
// slices' colours (e.g. green success / red failure); otherwise each slice
// takes the next colour from the theme's chart palette.
function DonutCard({
  title,
  description,
  data,
  colors,
}: {
  title: string
  description: string
  data: NamedCount[]
  colors?: Record<string, string>
}) {
  const colorFor = (name: string, i: number) =>
    colors?.[name] ??
    (name === "Other"
      ? "var(--muted-foreground)"
      : CHART_COLORS[i % CHART_COLORS.length])
  const config = Object.fromEntries(
    data.map((d, i) => [d.name, { label: d.name, color: colorFor(d.name, i) }])
  ) satisfies ChartConfig
  return (
    <StatCard title={title} description={description}>
      {/* The legend is rendered as a sibling below (not via recharts'
          <ChartLegend>) so that long, multi-row labels don't compete with the
          pie for the container's fixed height and collapse its radius to zero. */}
      <ChartContainer
        config={config}
        className="mx-auto aspect-square max-h-[200px] w-full"
      >
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent hideLabel />}
          />
          <Pie data={data} dataKey="count" nameKey="name" innerRadius={55}>
            {data.map((d, i) => (
              <Cell key={d.name} fill={colorFor(d.name, i)} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
        {data.map((d, i) => (
          <div key={d.name} className="flex max-w-[16rem] items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: colorFor(d.name, i) }}
            />
            <span
              className="scrollbar-hide min-w-0 overflow-x-auto py-0.5 leading-normal whitespace-nowrap text-muted-foreground"
              title={d.name}
            >
              {d.name}
            </span>
          </div>
        ))}
      </div>
    </StatCard>
  )
}

// A vertical bar (column) chart for ordered/sequential categories, e.g. hour of
// day. `interval` thins the axis ticks when there are many columns.
function ColumnCard({
  title,
  description,
  data,
  interval = 0,
}: {
  title: string
  description: string
  data: NamedCount[]
  interval?: number
}) {
  const config = {
    count: { label: "Sign-ins", color: "var(--chart-2)" },
  } satisfies ChartConfig
  return (
    <StatCard title={title} description={description}>
      <ChartContainer config={config} className="h-[220px] w-full">
        <BarChart accessibilityLayer data={data} margin={{ left: 4, right: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="name"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            interval={interval}
          />
          <YAxis hide />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <Bar dataKey="count" fill="var(--color-count)" radius={4} />
        </BarChart>
      </ChartContainer>
    </StatCard>
  )
}

// Charted overview of the loaded sign-ins: activity over time plus categorical
// breakdowns. Country, provider, connection-type and risk charts only appear
// once IP enrichment is available.
export function StatisticsView({
  rows,
  enrichment,
  crowdsec,
}: StatisticsViewProps) {
  const [filters, setFilters] = useState<StatFilters>(NO_FILTERS)

  // Filter options come from the whole dataset (every value stays selectable
  // regardless of the current filters), while the charts read the filtered rows.
  const options = useMemo(
    () => buildFilterOptions(rows, enrichment),
    [rows, enrichment]
  )
  const filtered = useMemo(
    () => filterRows(rows, enrichment, filters),
    [rows, enrichment, filters]
  )
  const stats = useMemo(
    () => computeStatistics(filtered, enrichment, crowdsec),
    [filtered, enrichment, crowdsec]
  )

  const timelineConfig = {
    success: { label: "Success", color: SUCCESS_COLOR },
    failure: { label: "Failure", color: FAILURE_COLOR },
  } satisfies ChartConfig

  return (
    <ViewContainer>
      <ViewHeader title="Statistics">
        <span className="text-sm text-muted-foreground">
          {filtered.length === rows.length
            ? quantity(rows.length, "sign-in")
            : `${filtered.length.toLocaleString()} of ${quantity(rows.length, "sign-in")}`}
        </span>
      </ViewHeader>

      <StatisticsFilters
        filters={filters}
        options={options}
        onChange={setFilters}
      />

      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No sign-ins match the selected filters.
        </p>
      ) : null}

      {stats.timeline.length > 1 ? (
        <StatCard
          title="Activity over time"
          description="Successful and failed sign-ins over time."
        >
          <ChartContainer config={timelineConfig} className="h-[240px] w-full">
            <AreaChart
              accessibilityLayer
              data={stats.timeline}
              margin={{ left: 4, right: 12 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={28}
              />
              <YAxis hide />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                dataKey="success"
                type="monotone"
                stackId="a"
                stroke="var(--color-success)"
                fill="var(--color-success)"
                fillOpacity={0.3}
              />
              <Area
                dataKey="failure"
                type="monotone"
                stackId="a"
                stroke="var(--color-failure)"
                fill="var(--color-failure)"
                fillOpacity={0.3}
              />
              <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ChartContainer>
        </StatCard>
      ) : null}

      {stats.hourOfDay.some((d) => d.count > 0) ? (
        <ColumnCard
          title="Sign-ins by hour of day"
          description="Sign-ins by the local hour they happened."
          data={stats.hourOfDay}
          interval={2}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {stats.dayOfWeek.some((d) => d.count > 0) ? (
          <ColumnCard
            title="Sign-ins by day of week"
            description="Sign-ins by the local day of the week they happened."
            data={stats.dayOfWeek}
          />
        ) : null}

        {stats.outcome.length > 0 ? (
          <DonutCard
            title="Outcome"
            description="How many sign-ins succeeded and failed."
            data={stats.outcome}
            colors={{ Success: SUCCESS_COLOR, Failure: FAILURE_COLOR }}
          />
        ) : null}

        {stats.auth.length > 0 ? (
          <DonutCard
            title="Authentication"
            description="Whether sign-ins used single or multi-factor authentication."
            data={stats.auth}
            colors={{
              "Multi-factor": SUCCESS_COLOR,
              "Single-factor": HUE.orange,
              Other: "var(--muted-foreground)",
            }}
          />
        ) : null}

        {stats.failureReasons.length > 0 ? (
          <DonutCard
            title="Failure reasons"
            description="Why failed sign-ins were rejected."
            data={stats.failureReasons}
          />
        ) : null}

        {stats.clientApps.length > 0 ? (
          <DonutCard
            title="Client apps"
            description="The client used to sign in."
            data={stats.clientApps}
          />
        ) : null}

        {stats.browsers.length > 0 ? (
          <DonutCard
            title="Browsers"
            description="Browsers used for browser-based sign-ins."
            data={stats.browsers}
          />
        ) : null}

        {stats.operatingSystems.length > 0 ? (
          <DonutCard
            title="Operating systems"
            description="Operating systems the devices reported."
            data={stats.operatingSystems}
          />
        ) : null}

        {stats.connectionTypes.length > 0 ? (
          <DonutCard
            title="Connection types"
            description="The kind of network the source IPs use."
            data={stats.connectionTypes}
          />
        ) : null}

        {stats.riskBands.length > 0 ? (
          <ColumnCard
            title="Risk distribution"
            description="Source IPs grouped by their CrowdSec reputation."
            data={stats.riskBands}
          />
        ) : null}

        {/* The "Top N" bar charts are grouped last so the categorical donuts
            read together above them. */}
        {stats.topUsers.length > 0 ? (
          <BarCard
            title="Top users"
            description="Accounts with the most sign-ins."
            data={stats.topUsers}
          />
        ) : null}

        {stats.topApps.length > 0 ? (
          <BarCard
            title="Top applications"
            description="Applications signed in to most often."
            data={stats.topApps}
          />
        ) : null}

        {stats.topIps.length > 0 ? (
          <BarCard
            title="Top source IPs"
            description="Most active source addresses."
            data={stats.topIps}
          />
        ) : null}

        {stats.topCountries.length > 0 ? (
          <BarCard
            title="Top countries"
            description="Where sign-ins originate."
            data={stats.topCountries}
          />
        ) : null}

        {stats.topProviders.length > 0 ? (
          <BarCard
            title="Top providers"
            description="Networks the source IPs belong to."
            data={stats.topProviders}
          />
        ) : null}
      </div>
    </ViewContainer>
  )
}
