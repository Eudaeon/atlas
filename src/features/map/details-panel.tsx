import { memo, useState } from "react"
import { ShieldAlert, X } from "lucide-react"

import { type LocationGroup, connectionsByUser } from "@/lib/facets"
import { reputationLevel } from "@/lib/crowdsec"
import { formatDetections } from "@/lib/proxycheck"
import { IpDetailsDialog } from "@/features/map/ip-details-dialog"
import {
  authRequirement,
  formatDate,
  operatingSystem,
  text,
  timestamp,
  withId,
} from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

type DetailsPanelProps = {
  group: LocationGroup
  colorFor: (user: string) => string
  // Receives the group's key so the parent can close this specific popover
  // while leaving any others open.
  onClose: (key: string) => void
}

// Status badge colours: green for success, red for failure.
function statusBadgeClass(success: boolean): string {
  return success
    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
    : "bg-destructive/15 text-destructive"
}

function Field({ label, value }: { label: string; value: string }) {
  // Hide fields we don't have a real value for.
  if (!value || value === "Unknown" || value === "—") return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-words">{value}</span>
    </div>
  )
}

// The floating popover anchored above a selected location, listing its
// connections grouped by user. Memoised because the panel re-anchors on every
// map "move" frame while open; with stable props it skips re-rendering its
// (potentially large) connection list as the map pans.
export const DetailsPanel = memo(function DetailsPanel({
  group,
  colorFor,
  onClose,
}: DetailsPanelProps) {
  const risk = reputationLevel(group.threat)
  const byUser = connectionsByUser(group, timestamp)
  // Whether the CrowdSec threat-intelligence dialog for this IP is open.
  const [detailsOpen, setDetailsOpen] = useState(false)

  return (
    <TooltipProvider>
      <div className="relative flex max-h-[26rem] w-96 flex-col gap-3 rounded-2xl bg-popover p-4 text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10">
        <div
          className="absolute -bottom-1.5 left-1/2 size-3 -translate-x-1/2 rotate-45 border-r border-b bg-popover"
          aria-hidden
        />
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center gap-2">
              <h2 className="scrollbar-hide min-w-0 overflow-x-auto text-base font-medium whitespace-nowrap">
                {group.ip || "Unknown IP"}
              </h2>
              {group.threat ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-7 shrink-0"
                        aria-label="CrowdSec IP details"
                        onClick={() => setDetailsOpen(true)}
                      />
                    }
                  >
                    <ShieldAlert />
                  </TooltipTrigger>
                  <TooltipContent>View CrowdSec threat data</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger render={<Badge className={risk.className} />}>
                  {risk.label}
                </TooltipTrigger>
                <TooltipContent>{formatDetections(group.data)}</TooltipContent>
              </Tooltip>
              {group.type ? (
                <Tooltip>
                  <TooltipTrigger render={<Badge variant="secondary" />}>
                    {group.type}
                  </TooltipTrigger>
                  <TooltipContent>{group.provider}</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close"
            className="-mt-1 -mr-1"
            onClick={() => onClose(group.key)}
          >
            <X />
          </Button>
        </div>

        <Accordion className="-mr-2 flex-1 overflow-y-auto rounded-none border-0 pr-2">
          {byUser.map(([user, connections]) => {
            const sample = connections[0].row
            const name =
              sample.userDisplayName || sample.userPrincipalName || "Unknown"
            const email = sample.userPrincipalName || ""
            return (
              <AccordionItem
                key={user}
                value={user}
                className="rounded-xl border bg-card not-last:mb-2 not-last:border-b"
              >
                <AccordionTrigger className="items-center gap-2 rounded-xl p-3 text-xs transition-colors hover:bg-muted/50 hover:no-underline">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: colorFor(user) }}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{name}</span>
                      {email && email !== name ? (
                        <span className="truncate font-normal text-muted-foreground">
                          {email}
                        </span>
                      ) : null}
                    </span>
                    <Badge variant="secondary" className="shrink-0">
                      {connections.length}
                    </Badge>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="px-3 pb-3 text-xs">
                  <div className="flex flex-col gap-2">
                    {connections.map((c, i) => {
                      const success = c.row.status?.errorCode === 0
                      return (
                        <div
                          key={c.row.id ?? i}
                          className="flex flex-col gap-2 rounded-xl border bg-background p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <Badge variant="outline">
                              {formatDate(c.row.createdDateTime)}
                            </Badge>
                            <Badge className={statusBadgeClass(success)}>
                              {success ? "Success" : "Failure"}
                            </Badge>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            {!success ? (
                              <Field
                                label="Failure reason"
                                value={text(c.row.status?.failureReason)}
                              />
                            ) : null}
                            <Field
                              label="Authentication Requirement"
                              value={authRequirement(c.row)}
                            />
                            <Field
                              label="Application"
                              value={withId(c.row.appDisplayName, c.row.appId)}
                            />
                            <Field
                              label="Device"
                              value={withId(
                                c.row.deviceDetail?.displayName,
                                c.row.deviceDetail?.deviceId
                              )}
                            />
                            <Field
                              label="OS"
                              value={operatingSystem(
                                c.row.deviceDetail?.operatingSystem
                              )}
                            />
                            <Field
                              label="Client"
                              value={text(c.row.clientAppUsed)}
                            />
                            <Field
                              label="Browser"
                              value={text(c.row.deviceDetail?.browser)}
                            />
                            <Field
                              label="User Agent"
                              value={text(c.row.userAgent)}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      </div>

      {group.threat ? (
        <IpDetailsDialog
          ip={group.ip}
          data={group.threat}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        />
      ) : null}
    </TooltipProvider>
  )
})
