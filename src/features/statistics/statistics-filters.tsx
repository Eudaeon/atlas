import { ChevronDown } from "lucide-react"

import type {
  FilterOptions,
  Option,
  StatFilters,
} from "@/lib/statistics-filters"
import { NO_FILTERS } from "@/lib/statistics-filters"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const OUTCOME_OPTIONS: Option[] = [
  { value: "success", label: "Success" },
  { value: "failure", label: "Failure" },
]

// A single filter: a button showing the current selection that opens a radio
// list of the available values, with an "All …" entry that clears it.
function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string
  allLabel: string
  value: string
  options: Option[]
  onChange: (value: string) => void
}) {
  const current =
    value === "all"
      ? allLabel
      : (options.find((o) => o.value === value)?.label ?? value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <span className="text-muted-foreground">{label}:</span>
        <span className="max-w-[12rem] truncate">{current}</span>
        <ChevronDown className="text-muted-foreground" />
      </DropdownMenuTrigger>
      {/* Size to the widest value rather than the trigger (the default
          --anchor-width), so long emails/names aren't wrapped and clipped —
          while staying at least as wide as the trigger and capped so one very
          long value can't make the menu run off-screen. */}
      <DropdownMenuContent
        align="start"
        className="max-h-80 w-fit max-w-[min(24rem,var(--available-width))] min-w-(--anchor-width) overflow-y-auto"
      >
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as string)}
        >
          <DropdownMenuRadioItem value="all" className="whitespace-nowrap">
            {allLabel}
          </DropdownMenuRadioItem>
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className="whitespace-nowrap"
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// The filter bar above the charts. User/app/country filters are hidden when
// there's nothing to choose between (one value or, for country, no enrichment
// yet); Outcome is always offered. A Clear button appears once any filter is set.
export function StatisticsFilters({
  filters,
  options,
  onChange,
}: {
  filters: StatFilters
  options: FilterOptions
  onChange: (filters: StatFilters) => void
}) {
  const active =
    filters.outcome !== "all" ||
    filters.user !== "all" ||
    filters.app !== "all" ||
    filters.country !== "all"

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterSelect
        label="Outcome"
        allLabel="All outcomes"
        value={filters.outcome}
        options={OUTCOME_OPTIONS}
        onChange={(value) =>
          onChange({ ...filters, outcome: value as StatFilters["outcome"] })
        }
      />
      {options.users.length > 1 ? (
        <FilterSelect
          label="User"
          allLabel="All users"
          value={filters.user}
          options={options.users}
          onChange={(value) => onChange({ ...filters, user: value })}
        />
      ) : null}
      {options.apps.length > 1 ? (
        <FilterSelect
          label="Application"
          allLabel="All applications"
          value={filters.app}
          options={options.apps}
          onChange={(value) => onChange({ ...filters, app: value })}
        />
      ) : null}
      {options.countries.length > 1 ? (
        <FilterSelect
          label="Country"
          allLabel="All countries"
          value={filters.country}
          options={options.countries}
          onChange={(value) => onChange({ ...filters, country: value })}
        />
      ) : null}
      {active ? (
        <Button variant="ghost" size="sm" onClick={() => onChange(NO_FILTERS)}>
          Clear
        </Button>
      ) : null}
    </div>
  )
}
