import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import {
  detailColumns,
  detailUnit,
  localTime,
  statusVariant,
  textColumns,
} from "@/lib/entra-logs"
import type { Detail, LogRow } from "@/lib/entra-logs"

/** An empty value, whichever column it sits in. A blank cell reads as a bug;
an em dash reads as "nothing here". */
export const NoValue = () => <span className="text-muted-foreground">—</span>

/** ponytail: enough English for `policies`, `steps`, `changes`, `details`.
Reach for a plural library the day a label needs more than this. */
const count = (n: number, unit: string) =>
  `${n} ${n === 1 ? unit.replace(/ies$/, "y").replace(/s$/, "") : unit}`

/** A list of sub-records: the policies a sign-in ran through, the properties an
audit record changed. */
function Details({ details }: { details: Array<Detail> }) {
  return (
    <div className="flex flex-col gap-3">
      {details.map((detail, index) => (
        <div key={index} className="flex flex-col gap-1">
          {index > 0 ? <Separator className="mb-2" /> : null}
          <p className="text-xs font-medium">{detail.title}</p>
          {detail.subtitle ? (
            <p className="font-mono text-[0.625rem] text-muted-foreground">
              {detail.subtitle}
            </p>
          ) : null}
          <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[0.6875rem]">
            {detail.entries.map(([name, value]) => (
              <div key={name} className="col-span-2 grid grid-cols-subgrid">
                <dt className="text-muted-foreground">{name}</dt>
                <dd className="break-words">{value || <NoValue />}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  )
}

/** Everything one record holds, empty columns left out. The table reads a row
across as many columns as fit on screen; this is the same row read down, which
is what a line in the Sessions and Analysis lists opens onto. */
export function RecordDetails({ row }: { row: LogRow }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
      {textColumns.map((name) =>
        row[name] === "" ? null : (
          <div
            key={name}
            className="col-span-2 grid grid-cols-subgrid items-baseline"
          >
            <dt className="text-muted-foreground">{name}</dt>
            <dd className="break-words">
              {name === "Date" ? (
                localTime(row[name])
              ) : name === "Status" ? (
                <Badge variant={statusVariant(row[name])}>{row[name]}</Badge>
              ) : (
                row[name]
              )}
            </dd>
          </div>
        )
      )}
      {/* The sub-records stay behind the same button they have in the table:
      nine conditional access policies spelled out is a screenful, and the
      record is being read for what is on it, not through it. */}
      {detailColumns.map((name) =>
        row[name].length === 0 ? null : (
          <div
            key={name}
            className="col-span-2 grid grid-cols-subgrid items-center"
          >
            <dt className="text-muted-foreground">{name}</dt>
            <dd>
              <DetailPopover label={detailUnit(name)} details={row[name]} />
            </dd>
          </div>
        )
      )}
    </dl>
  )
}

/** Cell for the columns whose value is a list of sub-records. */
export function DetailPopover({
  label,
  details,
}: {
  label: string
  details: Detail[]
}) {
  if (details.length === 0) {
    return <NoValue />
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="xs">
            {count(details.length, label)}
          </Button>
        }
      />
      <PopoverContent className="max-h-96 w-96 overflow-y-auto">
        <Details details={details} />
      </PopoverContent>
    </Popover>
  )
}
