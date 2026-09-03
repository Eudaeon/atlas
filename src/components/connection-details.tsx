import { Fragment } from "react"
import { IconExternalLink, IconX } from "@tabler/icons-react"

import abuseipdb from "@/assets/lookups/abuseipdb.png"
import ipinfo from "@/assets/lookups/ipinfo.png"
import ipqs from "@/assets/lookups/ipqs.png"
import virustotal from "@/assets/lookups/virustotal.svg"

import { cn, scrolls } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Item, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { localTime, statusVariant } from "@/lib/entra-logs"
import type { LogRow } from "@/lib/entra-logs"
import type { Point } from "@/lib/connection-points"

/** What each connection spells out, in the order it is worth reading. Every
export format is in here: each one leaves the other's fields empty, and an empty
one is left out rather than shown as a blank line. */
const fields = [
  "Reason",
  "Activity",
  "Category",
  "Service",
  "Workload",
  "Mailbox",
  "Target Type",
  "Authentication Requirement",
  "Conditional Access",
  "Application",
  "Resource",
  "Device",
  "OS",
  "Client",
  "Browser",
  "User-Agent",
] as const

/** Where else to read the same address. An investigation ends up on at least
one of them, and retyping the address into four tabs is the dull part of it.

Each carries the site's own mark, copied into `assets/lookups` rather than
loaded from the site: a favicon fetched to draw a row would send the visit
before the click, which is the one thing this dialog promises not to do. All
four read against a light background and a dark one, which is why AbuseIPDB is
the icon off their favicon and not the logo off their page. */
const lookups = [
  ["VirusTotal", "https://www.virustotal.com/gui/ip-address/", virustotal],
  ["AbuseIPDB", "https://www.abuseipdb.com/check/", abuseipdb],
  ["IPinfo", "https://ipinfo.io/", ipinfo],
  [
    "IPQS",
    "https://www.ipqualityscore.com/free-ip-lookup-proxy-vpn-test/lookup/",
    ipqs,
  ],
] as const

/** The four of them behind one button. A row of links under the address was
four things to read on a card that is already dense, and they are not read:
they are picked from, once, and only when the address is worth a second
opinion. Nothing is fetched until one is clicked, so the card stays as quiet as
the rest of the app. `noreferrer` so the site does not learn which page sent
the visit, and the address is encoded because it comes off a log rather than
out of a parser. */
function Lookups({ ip }: { ip: string }) {
  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Look ${ip} up elsewhere`}
                >
                  <IconExternalLink />
                </Button>
              }
            />
          }
        />
        <TooltipContent>Look up elsewhere</TooltipContent>
      </Tooltip>
      {/* Narrower than a dialog's default: four short names and an
      address do not fill 24rem, and the gap after them read as a column
      waiting for something. */}
      <DialogContent className="sm:max-w-2xs">
        <DialogHeader>
          <DialogTitle className={scrolls}>{ip}</DialogTitle>
          <DialogDescription>Opens in a new tab.</DialogDescription>
        </DialogHeader>
        <ItemGroup>
          {lookups.map(([name, at, icon]) => (
            <Item
              key={name}
              variant="outline"
              size="sm"
              render={
                <a
                  href={at + encodeURIComponent(ip)}
                  target="_blank"
                  rel="noreferrer"
                />
              }
            >
              <ItemMedia variant="icon">
                {/* Decorative: the name it sits beside already says which
                site this is. */}
                <img src={icon} alt="" className="size-4" />
              </ItemMedia>
              <ItemTitle>{name}</ItemTitle>
            </Item>
          ))}
        </ItemGroup>
      </DialogContent>
    </Dialog>
  )
}

/** Label beside value, the same two-column read as the record popover. A value
stays on its line and scrolls: a user agent wrapped over five lines pushed the
next connection off the card, and the front of one says what it is. */
function Field({ label, value }: { label: string; value: string }) {
  if (value === "") return null
  return (
    <div className="col-span-2 grid grid-cols-subgrid items-baseline">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={scrolls}>{value}</dd>
    </div>
  )
}

function Connection({ row }: { row: LogRow }) {
  return (
    <Card size="sm" className="gap-2 bg-background">
      <CardHeader>
        {/* Sized down out of the heading slot: it is the same date the lists
        and the record read out, and every one of those is body text. */}
        <CardTitle className="text-xs/relaxed font-normal text-muted-foreground tabular-nums">
          {localTime(row.Date)}
        </CardTitle>
        <CardAction>
          <Badge variant={statusVariant(row.Status)}>
            {row.Status || "Unknown"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          {fields.map((field) => (
            <Field key={field} label={field} value={row[field]} />
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

/** The card above a marker: the address, what is known against it, and every
connection from it grouped by who made it. */
export function ConnectionDetails({
  point,
  close,
}: {
  point: Point
  close: () => void
}) {
  const info = point.info
  const detections = info?.detections ?? []
  // What ProxyCheck knows about the operator, read out rather than hidden behind a
  // tooltip: which of these come back varies by address, so the empty ones drop
  // out instead of printing a label with nothing after it.
  const facts: Array<[string, string]> = [
    ["Operator", info?.company ?? ""],
    ["Network", info?.asn ?? ""],
    ["Kind", info?.type ?? ""],
  ]

  return (
    <div className="flex max-h-[min(42rem,var(--room,42rem))] w-96 flex-col gap-3 rounded-2xl bg-popover p-4 text-popover-foreground shadow-lg ring-1 ring-foreground/10">
      {/* Capped against the same height the card is, so the connections keep
      their share of a short card. Everything above the separator is read once;
      the list under it is what the card is opened for, and left to take its
      natural height it used to push that list down to a couple of lines.

      `shrink-0` because scrolling turns its own min-height off: once an open
      visitor takes the card to its ceiling, flex was free to squeeze this to
      seven pixels, and the address the card is about went with it.
      `overflow-x-clip` because a scroller on one axis makes a scroller of the
      other, and the close button's negative margin is four pixels wide. */}
      <div className="flex max-h-[calc(min(42rem,var(--room,42rem))*0.45)] shrink-0 flex-col gap-3 overflow-x-clip overflow-y-auto">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-2">
            <h2 className={cn("min-w-0 text-base font-medium", scrolls)}>
              {point.ip}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5">
              {detections.map(({ label, detail }) =>
                detail === "" ? (
                  <Badge key={label} variant="destructive">
                    {label}
                  </Badge>
                ) : (
                  <Tooltip key={label}>
                    <TooltipTrigger render={<Badge variant="destructive" />}>
                      {label}
                    </TooltipTrigger>
                    <TooltipContent>{detail}</TooltipContent>
                  </Tooltip>
                )
              )}
              {detections.length === 0 ? (
                <Badge variant="secondary">No detections</Badge>
              ) : null}
            </div>
          </div>
          {/* Both buttons pulled into the heading's own line rather than given
          one of their own: the card is read from the address down, and a row
          of controls above the findings would be read first. */}
          <div className="-mt-1 -mr-1 flex shrink-0 items-center">
            <Lookups ip={point.ip} />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close details"
              onClick={close}
            >
              <IconX />
            </Button>
          </div>
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {facts.map(([label, value]) =>
            value === "" ? null : (
              <Fragment key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className={cn("min-w-0 text-right", scrolls)}>{value}</dd>
              </Fragment>
            )
          )}
        </dl>
      </div>

      <Separator />

      <Accordion className="-mr-2 min-h-0 flex-1 overflow-y-auto rounded-none border-0 pr-2">
        {point.visitors.map((visitor) => {
          // The email under the name, and nothing else: the row is read for who
          // was here and how often, and both of those are already on it.
          const under = visitor.user === visitor.name ? "" : visitor.user
          return (
            <AccordionItem
              key={visitor.user}
              value={visitor.user}
              className="rounded-xl border bg-card not-last:mb-2"
            >
              <AccordionTrigger className="items-center gap-2 rounded-xl p-3 hover:bg-muted/50 hover:no-underline">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: visitor.color }}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cn("font-medium", scrolls)}>
                      {visitor.name}
                    </span>
                    {under === "" ? null : (
                      <span
                        className={cn(
                          "font-normal text-muted-foreground",
                          scrolls
                        )}
                      >
                        {under}
                      </span>
                    )}
                  </span>
                  <Badge variant="secondary" className="shrink-0">
                    {visitor.count}
                  </Badge>
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-3 pt-px pb-3">
                <div className="flex flex-col gap-2">
                  {visitor.rows.map((row, at) => (
                    <Connection key={row["Record ID"] || at} row={row} />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>
    </div>
  )
}
