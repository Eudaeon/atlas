import { Check, SlidersHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"
import { type Facet, type FacetValue, selectedCount } from "@/lib/facets"
import { PanelTab } from "@/features/map/panel-tab"
import { SelectAllButton } from "@/features/map/select-all-button"
import { Badge } from "@/components/ui/badge"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

type CategoriesPanelProps = {
  facets: Facet[]
  deselected: Set<string>
  onToggle: (key: string, checked: boolean) => void
  onToggleAll: (values: FacetValue[], select: boolean) => void
  open: boolean
  onToggleOpen: () => void
}

const TAB_ICON = <SlidersHorizontal className="size-4" />

function CountBadge({ selected, total }: { selected: number; total: number }) {
  return (
    <Badge variant="secondary" className="tabular-nums">
      {selected}/{total}
    </Badge>
  )
}

function CategoryValues({
  values,
  deselected,
  onToggle,
}: {
  values: FacetValue[]
  deselected: Set<string>
  onToggle: (key: string, checked: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {values.map(({ key, value, count }) => {
        const checked = !deselected.has(key)
        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key, checked)}
            aria-pressed={checked}
            className="flex items-center gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-muted"
          >
            <span
              className={cn(
                "flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border",
                checked
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/40"
              )}
            >
              {checked ? <Check className="size-2.5" /> : null}
            </span>
            <span
              className={cn(
                "scrollbar-hide min-w-0 flex-1 overflow-x-auto whitespace-nowrap",
                !checked && "text-muted-foreground line-through"
              )}
            >
              {value}
            </span>
            <Badge variant="secondary" className="shrink-0">
              {count}
            </Badge>
          </button>
        )
      })}
    </div>
  )
}

// Middle-right faceted filter. Each category is a collapsible list of its
// distinct values; toggling a value filters the connections shown on the map.
// Categories with a `groups` array render a second level of dropdowns (e.g. IP
// under IPv4/IPv6, countries under their continent).
export function CategoriesPanel({
  facets,
  deselected,
  onToggle,
  onToggleAll,
  open,
  onToggleOpen,
}: CategoriesPanelProps) {
  return (
    <div
      className={cn(
        "absolute top-1/2 right-0 z-10 flex max-h-[70vh] w-64 -translate-y-1/2 flex-col rounded-2xl bg-popover text-popover-foreground ring-1 ring-foreground/5 transition-transform duration-300 ease-out dark:ring-foreground/10",
        open ? "-translate-x-4 shadow-lg" : "translate-x-full"
      )}
    >
      <PanelTab
        side="right"
        label="CATEGORIES"
        icon={TAB_ICON}
        open={open}
        onToggle={onToggleOpen}
        shortcut="2"
      />
      <div className="px-3 pt-3 pb-2">
        <span className="text-xs font-medium">Categories</span>
      </div>
      <div className="overflow-y-auto px-2 pb-2">
        <Accordion multiple className="rounded-none border-0">
          {facets.map((facet) => {
            const selected = selectedCount(facet.values, deselected)
            const allSelected = selected === facet.values.length
            return (
              <AccordionItem key={facet.label} value={facet.label}>
                <AccordionTrigger className="px-2 py-2 text-xs hover:no-underline">
                  <span className="flex flex-1 items-center justify-between gap-2">
                    {facet.label}
                    <CountBadge
                      selected={selected}
                      total={facet.values.length}
                    />
                  </span>
                </AccordionTrigger>
                <AccordionContent className="px-1 pb-2">
                  <SelectAllButton
                    allSelected={allSelected}
                    onClick={() => onToggleAll(facet.values, !allSelected)}
                    className="mb-0.5 px-2 py-1"
                  />
                  {facet.groups ? (
                    <Accordion multiple className="ml-1 rounded-none border-0">
                      {facet.groups.map((g) => {
                        if (g.leaf)
                          return (
                            <CategoryValues
                              key={g.group}
                              values={[g.leaf]}
                              deselected={deselected}
                              onToggle={onToggle}
                            />
                          )
                        const gSelected = selectedCount(g.values, deselected)
                        const gAll = gSelected === g.values.length
                        return (
                          <AccordionItem key={g.group} value={g.group}>
                            <AccordionTrigger className="px-2 py-1.5 text-xs hover:no-underline">
                              <span className="flex flex-1 items-center justify-between gap-2">
                                {g.group}
                                <CountBadge
                                  selected={gSelected}
                                  total={g.values.length}
                                />
                              </span>
                            </AccordionTrigger>
                            <AccordionContent className="px-1 pb-2">
                              <SelectAllButton
                                allSelected={gAll}
                                onClick={() => onToggleAll(g.values, !gAll)}
                                className="mb-0.5 px-2 py-1"
                              />
                              <CategoryValues
                                values={g.values}
                                deselected={deselected}
                                onToggle={onToggle}
                              />
                            </AccordionContent>
                          </AccordionItem>
                        )
                      })}
                    </Accordion>
                  ) : (
                    <CategoryValues
                      values={facet.values}
                      deselected={deselected}
                      onToggle={onToggle}
                    />
                  )}
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      </div>
    </div>
  )
}
