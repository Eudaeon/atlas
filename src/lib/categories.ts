// The facetable attributes of a connection. Each category derives a single value
// from a row (plus its enrichment); these definitions drive both the filter
// panel and whether a connection passes the active filters. The Risk category
// reads CrowdSec's reputation verdict (see lib/crowdsec).

import type { SignIn } from "@/lib/signin"
import { connectionType, type ProxyData } from "@/lib/proxycheck"
import { type CrowdSecData, reputationLevel } from "@/lib/crowdsec"
import {
  authRequirement,
  browserFacet,
  ipVersion,
  osFacet,
  text,
  withId,
} from "@/lib/format"

// A facetable attribute of a connection. An optional `group` derives a coarser
// bucket, rendering the category as a two-level dropdown (e.g. IP grouped by
// IPv4/IPv6, countries grouped by continent). Both receive the row's ProxyCheck
// (`data`) and CrowdSec (`threat`) enrichment so any category can read either.
export type Category = {
  label: string
  value: (row: SignIn, data?: ProxyData, threat?: CrowdSecData) => string
  group?: (row: SignIn, data?: ProxyData, threat?: CrowdSecData) => string
  // When set, a group with a single value still renders as an expandable
  // dropdown rather than collapsing to a direct toggle, so the group level is
  // always visible (e.g. a continent with one country still shows the
  // continent).
  alwaysGroup?: boolean
}

export const CATEGORIES: Category[] = [
  {
    label: "IP",
    group: (row) => ipVersion(row.ipAddress),
    value: (row) => text(row.ipAddress),
  },
  {
    label: "Country",
    alwaysGroup: true,
    group: (_row, data) => text(data?.continent),
    value: (_row, data) => text(data?.country),
  },
  {
    label: "Status",
    value: (row) => (row.status?.errorCode === 0 ? "Success" : "Failure"),
  },
  {
    label: "Authentication Requirement",
    value: (row) => authRequirement(row),
  },
  {
    label: "Application",
    value: (row) => withId(row.appDisplayName, row.appId),
  },
  {
    label: "Device",
    value: (row) =>
      withId(row.deviceDetail?.displayName, row.deviceDetail?.deviceId),
  },
  {
    label: "OS",
    group: (row) => osFacet(row).group,
    value: (row) => osFacet(row).value,
  },
  { label: "Client", value: (row) => text(row.clientAppUsed) },
  {
    label: "Browser",
    group: (row) => browserFacet(row).group,
    value: (row) => browserFacet(row).value,
  },
  { label: "User Agent", value: (row) => text(row.userAgent) },
  {
    label: "Risk",
    value: (_row, _data, threat) => reputationLevel(threat).label,
  },
  { label: "Type", value: (_row, data) => text(connectionType(data)) },
  { label: "Provider", value: (_row, data) => text(data?.provider) },
]

// The deselect-key for a category's leaf value, combining the category label,
// the group (for nested categories), and the value. Grouped categories include
// the group so equal leaf values in different groups (e.g. the same browser
// version under different browsers) stay independent. Centralised so the keys
// produced when preparing rows and when building the facet panel always agree —
// and a pure composer so callers pass values they've already computed rather
// than re-evaluating the category functions.
export function leafKey(
  label: string,
  group: string | undefined,
  value: string
): string {
  return group === undefined
    ? `${label}::${value}`
    : `${label}::${group}::${value}`
}
