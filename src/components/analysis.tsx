import { useMemo, useState } from "react"
import {
  IconEyeOff,
  IconKey,
  IconLockOpen,
  IconPlane,
  IconRoute,
  IconShieldCheck,
  IconTargetArrow,
  IconUsers,
} from "@tabler/icons-react"
import type { Icon as TablerIcon } from "@tabler/icons-react"

import { cn, scrolls } from "@/lib/utils"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { EmptyView } from "@/components/empty-view"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Count, Lines, ShowOnMap } from "@/components/record-list"
import { useIpInfo } from "@/hooks/use-ip-info"
import { findings } from "@/lib/analysis"
import type { Finding, FindingKind } from "@/lib/analysis"
import type { LogRow } from "@/lib/entra-logs"

/** A picture per kind of finding, so a list of a thousand can be read down
without reading every line. Keyed by kind rather than by title: a new kind of
finding will not compile until it has a picture, and rewording a title cannot
quietly drop the one it had. */
const icons: Record<FindingKind, TablerIcon> = {
  spray: IconTargetArrow,
  network: IconEyeOff,
  travel: IconPlane,
  guessed: IconLockOpen,
  "shared-session": IconUsers,
  "roaming-session": IconRoute,
  audit: IconKey,
}

function Item({
  finding,
  onShow,
}: {
  finding: Finding
  onShow: (query: string) => void
}) {
  const high = finding.level === "high"
  const Icon = icons[finding.kind]
  return (
    <AccordionItem
      value={finding.id}
      // The level is a rail down the side rather than a chip in the row: it
      // reads off the edge of the list at a glance, and leaves the row itself
      // to say what happened.
      className={cn(
        "rounded-xl border border-l-4 not-last:mb-2",
        high ? "border-l-destructive" : "border-l-warning"
      )}
    >
      <div className="relative">
        <AccordionTrigger className="items-center gap-3 rounded-r-xl p-3 pr-16 hover:bg-muted/50 hover:no-underline">
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <Icon
              className={cn(
                "size-4 shrink-0",
                high ? "text-destructive" : "text-warning"
              )}
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={cn("font-medium", scrolls)}>
                {finding.subject}
              </span>
              <span
                className={cn("font-normal text-muted-foreground", scrolls)}
              >
                {finding.title} · {finding.detail}
              </span>
            </span>
          </span>
        </AccordionTrigger>
        <ShowOnMap onShow={() => onShow(finding.query)} />
      </div>
      <AccordionContent className="px-3 pb-3">
        <Lines rows={finding.rows} />
      </AccordionContent>
    </AccordionItem>
  )
}

/** What the records on screen are worth explaining: anonymised networks, trips
nobody made, sessions that changed network mid-way, addresses working through
accounts, runs of failures that end in a sign-in, and the audit records that
hand out access. */
export function Analysis({
  rows,
  onShow,
}: {
  rows: Array<LogRow>
  onShow: (query: string) => void
}) {
  const version = useIpInfo()
  // Rebuilt as lookups land: half of these are read off what ProxyCheck says.
  const found = useMemo(() => findings(rows), [rows, version])
  const [level, setLevel] = useState("all")
  // Empty is every kind, so a run that turns up a kind nobody has picked yet
  // still shows it.
  const [kinds, setKinds] = useState<Array<string>>([])

  const high = found.filter((one) => one.level === "high").length
  // Kinds in the order the analysis found them, under the title they read as,
  // with what each one is worth.
  const counts = new Map<FindingKind, { title: string; count: number }>()
  for (const one of found) {
    const seen = counts.get(one.kind)
    if (seen === undefined) counts.set(one.kind, { title: one.title, count: 1 })
    else seen.count += 1
  }

  const listed = found.filter(
    (one) =>
      (level === "all" || one.level === level) &&
      (kinds.length === 0 || kinds.includes(one.kind))
  )

  if (found.length === 0) {
    return (
      <EmptyView icon={IconShieldCheck} title="Nothing stands out">
        No anonymised networks, impossible travel, shared or roaming sessions,
        failures ending in a sign-in, one address against many accounts, or
        access changes on screen.
      </EmptyView>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          spacing={0}
          variant="outline"
          value={[level]}
          aria-label="Level"
          onValueChange={(value) => {
            if (value.length > 0) setLevel(value[0])
          }}
        >
          <ToggleGroupItem value="all">
            All <Count of={found.length} />
          </ToggleGroupItem>
          <ToggleGroupItem value="high">
            High <Count of={high} />
          </ToggleGroupItem>
          <ToggleGroupItem value="medium">
            Medium <Count of={found.length - high} />
          </ToggleGroupItem>
        </ToggleGroup>

        <ToggleGroup
          multiple
          variant="outline"
          className="flex-wrap"
          value={kinds}
          aria-label="Kind"
          onValueChange={setKinds}
        >
          {[...counts].map(([kind, { title, count }]) => {
            const Icon = icons[kind]
            return (
              <ToggleGroupItem key={kind} value={kind}>
                <Icon data-icon="inline-start" />
                {title} <Count of={count} />
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>
      </div>

      {listed.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing matches those filters.
        </p>
      ) : (
        <Accordion className="-mr-6 min-h-0 flex-1 overflow-y-auto rounded-none border-0 pr-6">
          {listed.map((finding) => (
            <Item key={finding.id} finding={finding} onShow={onShow} />
          ))}
        </Accordion>
      )}
    </div>
  )
}
