import { useMemo } from "react"
import { ArrowUpDown } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import type { SignIn } from "@/lib/signin"
import { formatDate, operatingSystem, text } from "@/lib/format"
import {
  connectionType,
  formatDetections,
  formatOperator,
  type EnrichmentMap,
} from "@/lib/proxycheck"
import {
  reputationLevel,
  type CrowdSecData,
  type CrowdSecMap,
} from "@/lib/crowdsec"
import { Button } from "@/components/ui/button"

type Column = {
  label: string
  // Fixed column width in px. The table uses a fixed layout so sorting never
  // reflows column widths based on the lengths of the currently visible rows.
  size: number
  accessor: (
    entry: SignIn,
    enrichment: EnrichmentMap,
    crowdsec: CrowdSecMap
  ) => string
}

function proxyData(entry: SignIn, enrichment: EnrichmentMap) {
  return entry.ipAddress ? enrichment[entry.ipAddress] : undefined
}

function threatData(entry: SignIn, crowdsec: CrowdSecMap) {
  return entry.ipAddress ? crowdsec[entry.ipAddress] : undefined
}

function crowdsecScore(data: CrowdSecData | undefined) {
  const total = data?.scores?.overall?.total
  return total == null ? "Unknown" : String(total)
}

function isSuccess(entry: SignIn) {
  return entry.status?.errorCode === 0
}

// The table reports the auth requirement in short form ("Single"/"Multi");
// elsewhere it reads "Single-factor"/"Multi-factor" (see format.authRequirement).
function authRequirementShort(entry: SignIn) {
  switch (entry.authenticationRequirement) {
    case "singleFactorAuthentication":
      return "Single"
    case "multiFactorAuthentication":
      return "Multi"
    default:
      return text(entry.authenticationRequirement)
  }
}

function browser(entry: SignIn) {
  if (entry.clientAppUsed !== "Browser") return "N/A"
  return text(entry.deviceDetail?.browser)
}

const COLUMNS: Column[] = [
  { label: "Request ID", size: 300, accessor: (e) => text(e.id) },
  { label: "Date", size: 190, accessor: (e) => formatDate(e.createdDateTime) },
  { label: "Name", size: 160, accessor: (e) => text(e.userDisplayName) },
  { label: "Email", size: 230, accessor: (e) => text(e.userPrincipalName) },
  { label: "Application", size: 170, accessor: (e) => text(e.appDisplayName) },
  { label: "Application ID", size: 300, accessor: (e) => text(e.appId) },
  { label: "IP Address", size: 150, accessor: (e) => text(e.ipAddress) },
  { label: "Client", size: 140, accessor: (e) => text(e.clientAppUsed) },
  { label: "User Agent", size: 320, accessor: (e) => text(e.userAgent) },
  {
    label: "Authentication Requirement",
    size: 270,
    accessor: authRequirementShort,
  },
  {
    label: "Status",
    size: 110,
    accessor: (e) => (isSuccess(e) ? "Success" : "Failure"),
  },
  {
    label: "Failure Reason",
    size: 220,
    accessor: (e) => (isSuccess(e) ? "N/A" : text(e.status?.failureReason)),
  },
  {
    label: "Device",
    size: 170,
    accessor: (e) => text(e.deviceDetail?.displayName),
  },
  {
    label: "Device ID",
    size: 300,
    accessor: (e) => text(e.deviceDetail?.deviceId),
  },
  {
    label: "OS",
    size: 130,
    accessor: (e) => operatingSystem(e.deviceDetail?.operatingSystem),
  },
  { label: "Browser", size: 140, accessor: browser },
]

const ENRICHMENT_COLUMNS: Column[] = [
  {
    label: "Provider",
    size: 150,
    accessor: (e, m) => text(proxyData(e, m)?.provider),
  },
  {
    label: "Organization",
    size: 190,
    accessor: (e, m) => text(proxyData(e, m)?.organisation),
  },
  {
    label: "Type",
    size: 130,
    accessor: (e, m) => text(connectionType(proxyData(e, m))),
  },
  {
    label: "Continent",
    size: 140,
    accessor: (e, m) => text(proxyData(e, m)?.continent),
  },
  {
    label: "Country",
    size: 150,
    accessor: (e, m) => text(proxyData(e, m)?.country),
  },
  {
    label: "Latitude",
    size: 120,
    accessor: (e, m) => text(proxyData(e, m)?.latitude),
  },
  {
    label: "Longitude",
    size: 120,
    accessor: (e, m) => text(proxyData(e, m)?.longitude),
  },
  {
    label: "Detections",
    size: 140,
    accessor: (e, m) => formatDetections(proxyData(e, m)),
  },
  {
    label: "Operator",
    size: 170,
    accessor: (e, m) => formatOperator(proxyData(e, m)?.operator),
  },
]

// CrowdSec-derived risk columns, shown once any IP has CrowdSec data.
const CROWDSEC_COLUMNS: Column[] = [
  {
    label: "Reputation",
    size: 130,
    accessor: (e, _m, c) => reputationLevel(threatData(e, c)).label,
  },
  {
    label: "Threat Score",
    size: 130,
    accessor: (e, _m, c) => crowdsecScore(threatData(e, c)),
  },
]

// The TanStack column definitions for the sign-in table, including the
// ProxyCheck enrichment columns once any IP has been enriched and the CrowdSec
// risk columns once any IP has CrowdSec data. Each header is a sort toggle;
// cells render the precomputed accessor value.
export function useSignInColumns(
  enrichment: EnrichmentMap,
  crowdsec: CrowdSecMap
): ColumnDef<SignIn, string>[] {
  const enriched = Object.keys(enrichment).length > 0
  const hasThreat = Object.keys(crowdsec).length > 0
  const columns = useMemo(
    () => [
      ...COLUMNS,
      ...(enriched ? ENRICHMENT_COLUMNS : []),
      ...(hasThreat ? CROWDSEC_COLUMNS : []),
    ],
    [enriched, hasThreat]
  )

  return useMemo(
    () =>
      columns.map((col) => ({
        id: col.label,
        size: col.size,
        accessorFn: (row) => col.accessor(row, enrichment, crowdsec),
        header: ({ column }) => (
          <Button
            variant="ghost"
            className="-ml-2"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {col.label}
            <ArrowUpDown />
          </Button>
        ),
        cell: ({ getValue }) => getValue(),
      })),
    [columns, enrichment, crowdsec]
  )
}
