import { IconHelp } from "@tabler/icons-react"

import { InputGroupButton } from "@/components/ui/input-group"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { luceneFields } from "@/lib/lucene-filter"

const syntax: Array<[string, string]> = [
  ["jelena", "matches any column"],
  ["os:windows", "matches one column"],
  ['resource:"Graph API"', "exact phrase"],
  ["browser:Chrome*", "* and ? are wildcards"],
  ["status:/Succ.../", "regular expression"],
  ["date:[2026-08-01 TO 2026-09-01]", "range, * for open-ended"],
  ["windows failure", "two terms mean AND"],
  ["os:Windows OR os:Linux", "AND, OR, NOT"],
  ["-status:Success", "- or NOT excludes"],
  ["status:(Success OR Failure)", "group terms in one column"],
]

/** The keys worth knowing, listed where they are needed rather than in a
dialog nobody opens. */
const keys: Array<[Array<string>, string]> = [
  [["/"], "search"],
  [["Ctrl", "K"], "search, from inside a box"],
  [["Enter"], "keep the search"],
  [["Esc"], "clear the search"],
  [["Alt", "1"], "table"],
  [["Alt", "2"], "map"],
  [["Alt", "3"], "sessions"],
  [["Alt", "4"], "statistics"],
  [["Alt", "5"], "analysis"],
  [["1"], "the map's users panel"],
  [["2"], "the map's categories panel"],
  [["3"], "the map's timeline"],
]

/** What you type on the left, what it does on the right. */
function Pairs({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      {rows.map(([term, meaning]) => (
        <div key={term} className="col-span-2 grid grid-cols-subgrid">
          <dt className="font-mono break-all">{term}</dt>
          <dd className="text-muted-foreground">{meaning}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Explains the query language and lists the field name for every column. Sits
in the search box's trailing addon.

A popover rather than a tooltip: it is a page of reference held open while a
query is written, and a field name is there to be read off and copied. */
export function SearchHelp() {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <InputGroupButton size="icon-xs" aria-label="Search syntax">
            <IconHelp />
          </InputGroupButton>
        }
      />
      <PopoverContent
        align="start"
        className="max-h-96 w-96 gap-3 overflow-y-auto"
      >
        <PopoverHeader>
          <PopoverTitle>Lucene search</PopoverTitle>
          <PopoverDescription>
            Terms match part of a value and ignore case.
          </PopoverDescription>
        </PopoverHeader>
        <Pairs rows={syntax} />
        <Separator />
        <p className="font-medium">Keys</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {keys.map(([combination, meaning]) => (
            <div
              key={combination.join(" ")}
              className="col-span-2 grid grid-cols-subgrid items-center"
            >
              <dt>
                <KbdGroup>
                  {combination.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </KbdGroup>
              </dt>
              <dd className="text-muted-foreground">{meaning}</dd>
            </div>
          ))}
        </dl>
        <Separator />
        <p className="font-medium">Field names</p>
        <Pairs rows={[...luceneFields]} />
      </PopoverContent>
    </Popover>
  )
}
