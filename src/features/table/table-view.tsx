import { useMemo } from "react"

import { DataTable } from "@/features/table/data-table"
import { useSignInColumns } from "@/features/table/sign-in-columns"
import { ViewContainer, ViewHeader } from "@/features/app-shell/view-container"
import { quantity } from "@/lib/format"
import type { EnrichmentMap } from "@/lib/proxycheck"
import type { CrowdSecMap } from "@/lib/crowdsec"
import type { SignIn } from "@/lib/signin"

type TableViewProps = {
  rows: SignIn[]
  enrichment: EnrichmentMap
  crowdsec: CrowdSecMap
}

// Columns hidden by default to keep the table scannable: raw GUIDs, raw
// coordinates, the verbose user agent (already summarised by OS/Browser/Client),
// and the continent (redundant with Country). All stay available in the column
// menu.
const HIDDEN_BY_DEFAULT = [
  "Request ID",
  "Application ID",
  "Device ID",
  "User Agent",
  "Continent",
  "Latitude",
  "Longitude",
]

// The raw sign-ins as a searchable, paginated table.
export function TableView({ rows, enrichment, crowdsec }: TableViewProps) {
  const columns = useSignInColumns(enrichment, crowdsec)
  // TanStack Table caches each cell's accessor result on the row (keyed by column
  // id) and only rebuilds its rows when the `data` reference changes. The
  // enrichment columns read `enrichment`/`crowdsec` through their accessors, so
  // when a later pass fills in IPs that showed "Unknown", the column ids and the
  // `rows` reference are both unchanged and the cached "Unknown" values would
  // stick. Hand the table a fresh array whenever enrichment lands so it rebuilds
  // those rows and the now-enriched cells update in place. `enrichment`/`crowdsec`
  // aren't read here on purpose: they're the trigger for a new reference.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => rows.slice(), [rows, enrichment, crowdsec])
  return (
    <ViewContainer wide>
      <ViewHeader title={quantity(rows.length, "sign-in")} />
      <DataTable
        columns={columns}
        data={data}
        pageSize={15}
        searchPlaceholder="Search…"
        initialColumnVisibility={Object.fromEntries(
          HIDDEN_BY_DEFAULT.map((label) => [label, false])
        )}
        // Feed the raw ISO timestamp for date queries so comparisons and ranges
        // sort chronologically, not by the localised text shown in the cell.
        searchValueOverrides={(row) => ({ Date: row.createdDateTime ?? "" })}
      />
    </ViewContainer>
  )
}
