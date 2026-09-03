import { useMemo } from "react"
import {
  IconAlertTriangle,
  IconChartBarOff,
  IconListDetails,
  IconUsers,
  IconWorld,
} from "@tabler/icons-react"
import { barY, defineChart } from "@tanstack/charts"
import { pie, polar, radialArc } from "@tanstack/charts/polar"
import { scaleBand } from "@tanstack/charts/scales/band"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { tooltip } from "@tanstack/charts/tooltip"
import { portal } from "@tanstack/charts/tooltip/portal"
import { Chart } from "@tanstack/charts/react"

import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ChartCard } from "@/components/chart-card"
import { EmptyView } from "@/components/empty-view"
import { useIpInfo } from "@/hooks/use-ip-info"
import { many } from "@/lib/analysis"
import { buildFacets, prepare } from "@/lib/facets"
import { summarise, topValues } from "@/lib/statistics"
import type { Day, Hour, Slice } from "@/lib/statistics"
import { localTime } from "@/lib/entra-logs"
import type { LogRow } from "@/lib/entra-logs"
import { cn } from "@/lib/utils"

/** Values listed per category before the rest are added up into one line. One
per palette colour: a sixth would come back round to the first and draw two
slices of a ring in the same colour. */
const perFacet = 5

/** What colour a value is drawn in. An outcome keeps the colour its badge has
wherever it is drawn, and everything else walks the palette by rank, which is
what tells one slice of a ring from the next. */
const fillOf = (value: string, at = 0) =>
  value === "Success"
    ? "var(--success)"
    : value === "Failure"
      ? "var(--destructive)"
      : // No policy ran, so the record neither passed nor failed anything. A
        // palette colour would put it beside Success as a third outcome.
        value === "Not Applied"
        ? "var(--muted-foreground)"
        : `var(--chart-${(at % 5) + 1})`

/** The slice standing for everything past the cut. The same grey as Not
Applied, washed out: a remainder is quieter than a value, and the two are
never in the same ring anyway. */
const leftovers =
  "color-mix(in oklab, var(--muted-foreground) 45%, transparent)"

/** `2026-08-14` is four times the width a column has, and the labels ran into
each other. The axis says the day, the card's title says the range. Hours are
two characters already and come back untouched. */
const shortDay = (at: string) =>
  at.length === 10
    ? new Date(`${at}T00:00:00`).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : at

/** The heading over a tooltip's rows. A day shortens the way the axis under it
does; an hour gets its minutes back, because `06` on its own reads as a date. */
const heading = (at: string) => (at.length === 2 ? `${at}:00` : shortDay(at))

/** One bar's worth of records: which column it belongs to, how they went, and
how many there were. Days and hours are the same shape to the chart. */
type Column = { at: string; status: string; count: number }

const columnsOf = (rows: Array<Day | Hour>): Array<Column> =>
  rows.map((one) => ({
    at: "day" in one ? one.day : one.hour,
    status: one.status,
    count: one.count,
  }))

/** Records over time, oldest on the left, each column split into how its
records went. */
function Bars({
  columns,
  height,
  label,
}: {
  columns: Array<Column>
  height: number
  label: string
}) {
  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barY(columns, {
            x: "at",
            y: "count",
            // Bars at one column stack, so this is the column's total sliced
            // by status rather than two bars fighting over the same band.
            z: "status",
            fill: (one: Column) => fillOf(one.status),
            radius: 2,
          }),
        ],
        scales: {
          x: {
            scale: () => scaleBand().padding(0.2),
            axis: { ticks: { format: shortDay } },
          },
          y: { scale: scaleLinear, nice: true, grid: true },
        },
        // The whole column at once, rather than whichever segment the pointer
        // happened to be over: the question a stacked bar answers is how the
        // day split, and that needs both numbers side by side.
        focus: "group-x",
        tooltip: {
          use: tooltip,
          anchor: "pointer",
          placement: ["right", "left"],
          offset: 14,
          // Written out rather than left to the default, which titles the box
          // with the series name and labels its rows `x` and `y` whenever a
          // column turns out to hold one status. Read off the columns, every
          // box is the same box: the day over the statuses under it.
          content: (points) => ({
            title: heading(String(points[0]?.xValue ?? "")),
            rows: points.map((point) => ({
              label: point.datum.status,
              value: point.datum.count.toLocaleString(),
              color: point.color,
            })),
          }),
        },
      }),
    [columns]
  )

  return <Chart definition={definition} height={height} ariaLabel={label} />
}

/** Which colour means what, for the charts that split a bar in two. */
function Legend({ statuses }: { statuses: Array<string> }) {
  return (
    <span className="flex items-center gap-3">
      {statuses.map((status) => (
        <span key={status} className="flex items-center gap-1.5">
          <span
            className="size-2 rounded-full"
            style={{ background: fillOf(status) }}
          />
          {status}
        </span>
      ))}
    </span>
  )
}

const percent = (share: number) =>
  share > 0 && share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`

/** One slice of a category, coloured. `pie` overwrites a field called `value`
with its own number, so the name is carried under a different one. */
type Wedge = {
  name: string
  count: number
  share: number
  rest: boolean
  fill: string
}

const wedgesOf = (slices: Array<Slice>): Array<Wedge> =>
  slices.map((slice, at) => ({
    name: slice.value,
    count: slice.count,
    share: slice.share,
    rest: slice.rest !== undefined,
    fill: slice.rest === undefined ? fillOf(slice.value, at) : leftovers,
  }))

/** A category as a ring. Shares are what these cards are read for, and a ring
shows a share without the reader working it out of a bar's length. */
function Donut({ wedges, label }: { wedges: Array<Wedge>; label: string }) {
  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          polar({
            inset: 1,
            marks: [
              radialArc(pie(wedges, { value: "count" }), {
                innerRadius: ({ radius }) => radius * 0.62,
                cornerRadius: 3,
                key: "name",
                fill: (wedge) => wedge.fill,
              }),
            ],
            scales: { angle: null, radius: null },
          }),
        ],
        scales: { x: null, y: null },
        // Left to itself the tooltip reads a polar mark back as the angle and
        // radius under the pointer, which says nothing. The slice knows what
        // it is, so it says that instead, in the one line the columns use.
        tooltip: {
          use: tooltip,
          // A ring is 112px wide and the box is otherwise held inside it, which
          // breaks a word like Authentication across four lines. Portalled, it
          // measures itself against the window.
          portal,
          anchor: "pointer",
          placement: ["right", "left"],
          offset: 14,
          content: (points) => ({
            rows: points.map((point) => ({
              label: point.datum.name,
              value: percent(point.datum.share),
              color: point.datum.fill,
            })),
          }),
        },
      }),
    [wedges]
  )

  return <Chart definition={definition} height={124} ariaLabel={label} />
}

/** The numbers the ring cannot say: a slice a hair wide still gets a line of
its own here, with what it is and what it is worth. */
function Breakdown({ wedges }: { wedges: Array<Wedge> }) {
  return (
    // The name column is as wide as the longest name and no wider, so the
    // counts sit beside the list rather than out at the card's far edge. It can
    // still shrink under that, which is what leaves a long name room to
    // truncate on a narrow card.
    <dl className="grid w-fit max-w-full min-w-0 grid-cols-[auto_minmax(0,max-content)_auto] items-baseline gap-x-2 gap-y-1">
      {wedges.map((wedge) => (
        <div
          key={wedge.name}
          className="col-span-3 grid grid-cols-subgrid items-baseline"
        >
          <span
            className="size-2 translate-y-px rounded-full"
            style={{ background: wedge.fill }}
          />
          <dt
            className={cn(
              "truncate text-xs",
              wedge.rest && "text-muted-foreground italic"
            )}
            title={wedge.name}
          >
            {wedge.name}
          </dt>
          <dd className="text-xs text-muted-foreground tabular-nums">
            {wedge.count.toLocaleString()}
            <span className="ml-1.5 opacity-70">{percent(wedge.share)}</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** What the records on screen are made of: the headline counts, when they
happened, and every category the map filters by. */
export function Statistics({ rows }: { rows: Array<LogRow> }) {
  const version = useIpInfo()
  // The version is a dependency rather than an argument: the lookups fill the
  // ProxyCheck categories in as they land, and `prepare` reads them off the store.
  const facets = useMemo(() => buildFacets(prepare(rows)), [rows, version])
  const summary = useMemo(() => summarise(rows), [rows])
  const days = useMemo(() => columnsOf(summary.days), [summary])
  const hours = useMemo(() => columnsOf(summary.hours), [summary])
  const statuses = useMemo(
    () => [...new Set(summary.days.map((one) => one.status))].sort(),
    [summary]
  )

  // Counting nothing draws a wall of zeroes and a row of cards with no bars in
  // them, which reads as a broken page rather than as an empty one.
  if (rows.length === 0) {
    return (
      <EmptyView icon={IconChartBarOff} title="Nothing to count">
        Widen the search, show a file again, or switch an export back on.
      </EmptyView>
    )
  }

  // The 6 that comes off and goes straight back on is `main`'s own padding,
  // moved inside the scroller. That puts the scrollbar against the window
  // instead of against the cards, and leaves the cards room for the ring they
  // are outlined with, which a scroller clips wherever it runs out of room.
  return (
    <div className="-m-6 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Records"
          icon={IconListDetails}
          value={rows.length.toLocaleString()}
          note={
            summary.first === ""
              ? undefined
              : `${localTime(summary.first)} to ${localTime(summary.last)}`
          }
        />
        <Tile
          label="Users"
          icon={IconUsers}
          value={summary.users.toLocaleString()}
          note={
            summary.users === 0
              ? undefined
              : `${Math.round(rows.length / summary.users).toLocaleString()} records per user`
          }
        />
        <Tile
          label="Addresses"
          icon={IconWorld}
          value={summary.addresses.toLocaleString()}
          note={
            summary.users === 0
              ? undefined
              : `${(summary.addresses / summary.users).toFixed(1)} per user`
          }
        />
        <Tile
          label="Failures"
          icon={IconAlertTriangle}
          value={summary.failures.toLocaleString()}
          note={`${percent(summary.failures / rows.length)} of records`}
          alarming={summary.failures > 0}
        />
      </div>
      {summary.days.length === 0 ? null : (
        <div className="grid gap-3 lg:grid-cols-3">
          <ChartCard
            className="lg:col-span-2"
            title={`Records per day · ${many(new Set(summary.days.map((one) => one.day)).size, "day")}`}
            aside={<Legend statuses={statuses} />}
          >
            <Bars
              columns={days}
              height={200}
              label="Records per day, split by status"
            />
          </ChartCard>
          <ChartCard
            title="Records by hour"
            aside={
              <span>{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
            }
          >
            <Bars
              columns={hours}
              height={200}
              label="Records by hour of the day, split by status"
            />
          </ChartCard>
        </div>
      )}
      <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {facets.map((facet) => {
          const wedges = wedgesOf(topValues(facet.values, perFacet))
          return (
            <ChartCard
              key={facet.label}
              title={facet.label}
              aside={many(facet.values.length, "value")}
            >
              <div className="flex items-center justify-center gap-4">
                <div className="w-28 shrink-0">
                  <Donut
                    wedges={wedges}
                    label={`${facet.label}, by share of records`}
                  />
                </div>
                <Breakdown wedges={wedges} />
              </div>
            </ChartCard>
          )
        })}
      </div>
    </div>
  )
}

/** One headline count: what it counts, the number, and the line that gives the
number something to be read against. */
function Tile({
  label,
  value,
  note,
  icon: Icon,
  alarming,
}: {
  label: string
  value: string
  note?: string
  icon: typeof IconWorld
  alarming?: boolean
}) {
  return (
    <Card size="sm" className="gap-2">
      <CardHeader>
        <CardTitle className="font-normal text-muted-foreground">
          {label}
        </CardTitle>
        <CardAction>
          <Icon className="size-4 text-muted-foreground" />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-0.5">
        <span
          className={cn(
            "text-xl font-medium tabular-nums",
            alarming && "text-destructive"
          )}
        >
          {value}
        </span>
        {note === undefined ? null : (
          <span className="text-muted-foreground">{note}</span>
        )}
      </CardContent>
    </Card>
  )
}
