import { useMemo, useState } from "react"
import { IconClockOff } from "@tabler/icons-react"

import { cn, scrolls } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { EmptyView } from "@/components/empty-view"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Count, Lines, ShowOnMap } from "@/components/record-list"
import { field, many } from "@/lib/analysis"
import { userColor } from "@/lib/connection-points"
import { sessionsFrom } from "@/lib/sessions"
import type { Session } from "@/lib/sessions"
import { localTime } from "@/lib/entra-logs"
import type { LogRow } from "@/lib/entra-logs"

/** How long a session ran, in the largest unit that still says something. An
empty string when either end is missing, which is what a record with no date
leaves behind. */
function spanOf(first: string, last: string) {
  const ms = Date.parse(last) - Date.parse(first)
  if (!Number.isFinite(ms) || ms < 0) return ""
  const minutes = Math.round(ms / 60000)
  if (minutes < 1) return "under a minute"
  if (minutes < 60) return many(minutes, "minute")
  const hours = Math.round(minutes / 60)
  if (hours < 48) return many(hours, "hour")
  return many(Math.round(hours / 24), "day")
}

const failuresIn = (rows: Array<LogRow>) =>
  rows.filter((row) => row.Status === "Failure").length

/** When a session ran. A session that started and ended on one day says the
day once: almost all of them do, and repeating it twice a line is the noise the
duration has to be read through. */
function ran(first: string, last: string) {
  const ended = Date.parse(last)
  if (first.slice(0, 10) !== last.slice(0, 10) || Number.isNaN(ended))
    return `${localTime(first)} to ${localTime(last)}`
  return `${localTime(first)} to ${new Date(ended).toLocaleTimeString()}`
}

/** The addresses, devices and applications one session was used from, as one
line of chips each. */
function Used({ label, values }: { label: string; values: Array<string> }) {
  if (values.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {values.map((value) => (
        <Badge key={value} variant="outline">
          {value}
        </Badge>
      ))}
    </div>
  )
}

function Item({
  session,
  onShow,
}: {
  session: Session
  onShow: (query: string) => void
}) {
  const roaming = session.addresses.length > 1
  const failed = failuresIn(session.rows)
  const span = spanOf(session.first, session.last)
  return (
    <AccordionItem
      value={session.id}
      // Roaming is the one worth opening, so it gets the rail down the side as
      // well as the red address count.
      className={cn(
        "rounded-xl border not-last:mb-2",
        roaming && "border-l-4 border-l-destructive"
      )}
    >
      <div className="relative">
        <AccordionTrigger className="items-center gap-3 rounded-xl p-3 pr-16 hover:bg-muted/50 hover:no-underline">
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: userColor(session.users[0] ?? "") }}
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={cn("font-medium", scrolls)}>
                {session.name || session.users.join(", ")}
              </span>
              <span
                className={cn("font-normal text-muted-foreground", scrolls)}
              >
                {session.first === ""
                  ? session.id
                  : [ran(session.first, session.last), span]
                      .filter((part) => part !== "")
                      .join(" · ")}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {failed === 0 ? null : (
                <Badge variant="destructive">{failed} failed</Badge>
              )}
              <Badge variant={roaming ? "destructive" : "outline"}>
                {many(session.addresses.length, "address")}
              </Badge>
              <Badge variant="secondary">
                {session.rows.length.toLocaleString()}
              </Badge>
            </span>
          </span>
        </AccordionTrigger>
        <ShowOnMap onShow={() => onShow(field("sessionId", session.id))} />
      </div>
      <AccordionContent className="px-3 pb-3">
        <div className="flex flex-col gap-2">
          <Used label="Account" values={session.users} />
          <Used label="From" values={session.addresses} />
          <Used label="On" values={session.devices} />
          <Used label="Reaching" values={session.apps} />
          <span className={cn("text-xs text-muted-foreground", scrolls)}>
            {session.id}
          </span>
          <Lines rows={session.rows} />
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}

/** The sign-ins on screen grouped by the session id Entra filed them under, so
one session reads as one thing rather than as a run of rows. Sessions used from
more than one address come first. */
export function Sessions({
  rows,
  onShow,
}: {
  rows: Array<LogRow>
  onShow: (query: string) => void
}) {
  const sessions = useMemo(() => sessionsFrom(rows), [rows])
  const [only, setOnly] = useState("all")

  const roaming = sessions.filter(
    (session) => session.addresses.length > 1
  ).length
  const failing = sessions.filter(
    (session) => failuresIn(session.rows) > 0
  ).length

  const listed = sessions.filter((session) =>
    only === "roaming"
      ? session.addresses.length > 1
      : only === "failed"
        ? failuresIn(session.rows) > 0
        : true
  )

  if (sessions.length === 0) {
    return (
      <EmptyView icon={IconClockOff} title="No sessions">
        Only sign-in and Purview records carry a session id, and none of the
        records on screen have one.
      </EmptyView>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          spacing={0}
          variant="outline"
          value={[only]}
          aria-label="Sessions"
          onValueChange={(value) => {
            if (value.length > 0) setOnly(value[0])
          }}
        >
          <ToggleGroupItem value="all">
            All <Count of={sessions.length} />
          </ToggleGroupItem>
          <ToggleGroupItem value="roaming">
            Roaming <Count of={roaming} />
          </ToggleGroupItem>
          <ToggleGroupItem value="failed">
            With failures <Count of={failing} />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {listed.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No sessions match that filter.
        </p>
      ) : (
        <Accordion className="-mr-6 min-h-0 flex-1 overflow-y-auto rounded-none border-0 pr-6">
          {listed.map((session) => (
            <Item key={session.id} session={session} onShow={onShow} />
          ))}
        </Accordion>
      )}
    </div>
  )
}
