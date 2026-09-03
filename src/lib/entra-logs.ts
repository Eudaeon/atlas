import type { IpInfo } from "@/lib/ip-lookup"
import { appName, loadAppNames } from "@/lib/microsoft-apps"
import {
  isPurviewExport,
  named,
  purviewClient,
  purviewIp,
  purviewRecord,
  purviewRecords,
  purviewStatus,
  purviewUserAgent,
} from "@/lib/purview-audit"

type Raw = Record<string, any>

const authRequirement: Record<string, string | undefined> = {
  singleFactorAuthentication: "Single",
  multiFactorAuthentication: "Multi",
}

const conditionalAccess: Record<string, string | undefined> = {
  success: "Success",
  failure: "Failure",
  notApplied: "Not Applied",
}

/** One expandable sub-record: a heading plus its label/value pairs. */
export type Detail = {
  title: string
  subtitle: string
  entries: Array<[string, string]>
}

const text = (value: unknown) => String(value ?? "")

/** The few run-together words that are initials rather than words. Anything
not in here keeps whatever case Entra sent, which is what leaves `Azure` and
`AD` alone. */
const initials: Record<string, string> = { ip: "IP", mfa: "MFA", sso: "SSO" }

/** Entra files these values in the wire format: `notEnabled`, `devicePlatform`,
`ipAddressSeenByAzureAD`. Split at the humps and at the commas, so a policy
reads as words and a long list of conditions wraps between them rather than
through the middle of one. */
const words = (value: unknown): string =>
  text(value)
    .split(",")
    .map((token) =>
      token
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .replace(/^./, (first) => first.toUpperCase())
        .replace(/[A-Za-z]+/g, (word) => initials[word.toLowerCase()] ?? word)
    )
    .filter((token) => token !== "")
    .join(", ")

const list = (values: unknown): string =>
  Array.isArray(values) && values.length > 0
    ? values.map(words).join(", ")
    : "None"

const rules = (prefix: string, satisfied: Raw[] | undefined) =>
  (satisfied ?? []).map((rule): [string, string] => [
    `${prefix}: ${words(rule.conditionalAccessCondition)}`,
    words(rule.ruleSatisfied),
  ])

/** Entra writes the Apple platforms as `Ios` and `MacOs`, sometimes with a
version after them. Only the name is rewritten; the rest is left alone. */
const osName = (value: unknown) =>
  typeof value === "string"
    ? value.replace(/^Ios\b/, "iOS").replace(/^MacOs\b/, "macOS")
    : value

/** `Redeem external user invite` and its kind write a whole record into the
target's display name: `UPN: x, Email: y, InvitationId: z, Source: w`. Splits it
back into its pairs. A plain name comes back as one entry. */
const nameEntries = (value: unknown): Array<[string, string]> => {
  const name = text(value)
  if (!/^[A-Za-z][\w ]*: /.test(name)) return [["Display name", name]]
  return name.split(/,\s+(?=[A-Za-z][\w ]*: )/).map((pair) => {
    const at = pair.indexOf(": ")
    return [pair.slice(0, at), pair.slice(at + 2)]
  })
}

/** An audit record aims at one or more resources. Reads the same field off each
of them, so a record with two targets shows both in the cell. */
const targets = (r: Raw, pick: (target: Raw) => unknown) =>
  (r.targetResources ?? [])
    .map(pick)
    .filter((value: unknown) => value != null && value !== "")
    .join(", ")

/** How a status reads as a chip, wherever one is drawn. Only the two words
Entra actually files carry a colour: a record with no status, and the audit
words that are neither, stay neutral. */
export const statusVariant = (status: string) =>
  status === "Failure"
    ? ("destructive" as const)
    : status === "Success"
      ? ("success" as const)
      : ("secondary" as const)

/** Renders an instant in the browser's locale and zone. Display only: the
value kept on a row stays as it arrived, because sorting and range queries
parse it back, and a localized string is NaN to `Date.parse` in most locales. */
export const localTime = (value: string) => {
  const time = Date.parse(value)
  return Number.isNaN(time) ? value : new Date(time).toLocaleString()
}

// A column is one record: where its value comes from, how wide it sits, and for
// the expandable ones what its trigger counts. The table lays out fixed, so a
// column keeps its width whatever subset of rows the virtualizer has mounted.
// Longer values scroll inside their own cell.
//
// Sign-in logs and audit logs share this one set of columns. A column reads
// whichever of the two shapes it finds, and comes out empty for the format that
// has no such field.
const detailFields = {
  "Conditional Access Policies": {
    width: 200,
    unit: "policies",
    read: (r: Raw): Detail[] =>
      (r.appliedConditionalAccessPolicies ?? []).map((policy: Raw) => ({
        title: policy.displayName,
        subtitle: policy.id,
        entries: [
          ["Result", words(policy.result)],
          ["Grant controls", list(policy.enforcedGrantControls)],
          ["Session controls", list(policy.enforcedSessionControls)],
          ["Conditions satisfied", words(policy.conditionsSatisfied)],
          ["Conditions not satisfied", words(policy.conditionsNotSatisfied)],
          ...rules("Include", policy.includeRulesSatisfied),
          ...rules("Exclude", policy.excludeRulesSatisfied),
        ],
      })),
  },
  "Authentication Details": {
    width: 200,
    unit: "steps",
    read: (r: Raw): Detail[] =>
      (r.authenticationDetails ?? []).map((step: Raw) => ({
        title: step.authenticationMethod,
        subtitle: step.authenticationMethodDetail,
        entries: [
          ["Date", localTime(step.authenticationStepDateTime)],
          ["Succeeded", step.succeeded ? "Yes" : "No"],
          ["Result detail", words(step.authenticationStepResultDetail)],
          ["Requirement", words(step.authenticationStepRequirement)],
        ],
      })),
  },
  Target: {
    width: 200,
    unit: "targets",
    read: (r: Raw): Detail[] =>
      (r.targetResources ?? []).map((target: Raw) => ({
        title: text(
          target.userPrincipalName ?? target.displayName ?? target.id
        ),
        subtitle: text(target.id),
        entries: [
          ["Type", text(target.type)],
          ...nameEntries(target.displayName),
          ["Group type", text(target.groupType)],
        ] as Array<[string, string]>,
      })),
  },
  "Modified Properties": {
    width: 200,
    unit: "changes",
    read: (r: Raw): Detail[] =>
      (r.targetResources ?? []).flatMap((target: Raw) =>
        (target.modifiedProperties ?? []).map((property: Raw) => ({
          title: text(property.displayName),
          subtitle: text(target.displayName ?? target.userPrincipalName),
          entries: [
            ["Old", text(property.oldValue)],
            ["New", text(property.newValue)],
          ] as Array<[string, string]>,
        }))
      ),
  },
  "Additional Details": {
    width: 200,
    unit: "details",
    read: (r: Raw): Detail[] =>
      (r.additionalDetails ?? []).map((detail: Raw) => ({
        title: text(detail.key),
        subtitle: text(detail.value),
        entries: [],
      })),
  },
  // What an Exchange admin command was given. On a `New-InboxRule` this is the
  // rule: the folder mail was moved to, the address it was forwarded to, the
  // subject that triggered it. The row is unreadable without it.
  Parameters: {
    width: 200,
    unit: "settings",
    read: (r: Raw): Detail[] =>
      !Array.isArray(r.Parameters) || r.Parameters.length === 0
        ? []
        : [
            {
              title: text(r.Operation),
              subtitle: text(r.ObjectId),
              entries: r.Parameters.map((parameter: Raw): [string, string] => [
                text(parameter.Name),
                text(parameter.Value),
              ]),
            },
          ],
  },
}

// Reading order: when and how it went, who, from where, how they proved it,
// what they reached, on what. The audit-only columns and the identifiers no one
// reads by eye come last, and most of those start hidden.
const fields = {
  Date: {
    width: 200,
    read: (r: Raw) => r.createdDateTime ?? r.activityDateTime ?? r.CreationDate,
  },
  Status: {
    width: 140,
    // Sign-ins carry an error code, audit records a `result` word.
    read: (r: Raw) =>
      r.status
        ? r.status.errorCode === 0
          ? "Success"
          : "Failure"
        : r.ResultStatus !== undefined
          ? purviewStatus(r)
          : text(r.result).replace(/^./, (first) => first.toUpperCase()),
  },
  // Not `Failure Reason`: a sign-in only explains itself when it failed, but
  // an audit record explains what it did either way, and `User registered all
  // required security info` under a failure heading reads as a bug.
  Reason: {
    width: 280,
    read: (r: Raw) =>
      r.status
        ? r.status.errorCode === 0
          ? ""
          : r.status.failureReason
        : // Purview names the error rather than spelling it out: `IdsLocked`,
          // `InvalidUserNameOrPassword`. Kept as it arrived, because that is
          // the name to search on.
          (r.resultReason ?? r.LogonError),
  },
  Name: {
    width: 200,
    read: (r: Raw) => r.userDisplayName ?? r.initiatedBy?.user?.displayName,
  },
  Email: {
    width: 280,
    read: (r: Raw) =>
      r.userPrincipalName ?? r.initiatedBy?.user?.userPrincipalName ?? r.UserId,
  },
  "User ID": {
    width: 280,
    read: (r: Raw) => r.userId ?? r.initiatedBy?.user?.id ?? r.UserKey,
  },
  "IP Address": {
    width: 140,
    read: (r: Raw) =>
      r.ipAddress ?? r.initiatedBy?.user?.ipAddress ?? purviewIp(r),
  },
  Client: {
    width: 140,
    read: (r: Raw) => r.clientAppUsed ?? purviewClient(r),
  },
  "Authentication Requirement": {
    width: 200,
    read: (r: Raw) =>
      authRequirement[r.authenticationRequirement] ??
      r.authenticationRequirement,
  },
  "Conditional Access": {
    width: 200,
    read: (r: Raw) =>
      conditionalAccess[r.conditionalAccessStatus] ?? r.conditionalAccessStatus,
  },
  Application: {
    width: 200,
    read: (r: Raw) =>
      r.appDisplayName ??
      r.initiatedBy?.app?.displayName ??
      // Purview writes the id and no name, so the name comes off the list of
      // Microsoft's own applications. Read after `loadAppNames` has resolved,
      // which is what `parseRecordsInSlices` awaits before it reads a record.
      appName(r.ApplicationId || r.ClientAppId || r.AppId),
  },
  "Application ID": {
    width: 280,
    // `||` down the Purview half: an admin record writes the two it has no
    // value for as empty strings rather than leaving them out.
    read: (r: Raw) =>
      r.appId ??
      r.initiatedBy?.app?.appId ??
      (r.ApplicationId || r.ClientAppId || r.AppId),
  },
  Resource: { width: 200, read: (r: Raw) => r.resourceDisplayName },
  "Resource ID": { width: 280, read: (r: Raw) => r.resourceId },
  Mailbox: { width: 280, read: (r: Raw) => r.MailboxOwnerUPN },
  Device: {
    width: 200,
    read: (r: Raw) =>
      r.deviceDetail?.displayName ?? named(r.DeviceProperties, "DisplayName"),
  },
  OS: {
    width: 140,
    read: (r: Raw) =>
      osName(
        r.deviceDetail?.operatingSystem ?? named(r.DeviceProperties, "OS")
      ),
  },
  Browser: {
    width: 200,
    read: (r: Raw) =>
      r.deviceDetail?.browser ?? named(r.DeviceProperties, "BrowserType"),
  },
  "Device ID": {
    width: 280,
    read: (r: Raw) =>
      r.deviceDetail?.deviceId ??
      (named(r.DeviceProperties, "Id") || r.DeviceId),
  },
  "User-Agent": {
    width: 280,
    read: (r: Raw) => r.userAgent ?? purviewUserAgent(r),
  },
  Activity: {
    width: 200,
    read: (r: Raw) => r.activityDisplayName ?? r.Operation,
  },
  Category: { width: 160, read: (r: Raw) => r.category },
  Service: { width: 200, read: (r: Raw) => r.loggedByService },
  // Which service logged it, as Purview names it: `Exchange`,
  // `AzureActiveDirectory`. Nothing else fills this, so it is also what tells
  // a Purview row from the other two.
  Workload: { width: 160, read: (r: Raw) => r.Workload },
  "Target Type": {
    width: 140,
    read: (r: Raw) => targets(r, (target) => target.type),
  },
  "Target ID": {
    width: 280,
    read: (r: Raw) => targets(r, (target) => target.id),
  },
  "Session ID": {
    width: 280,
    read: (r: Raw) =>
      r.sessionId ?? (r.SessionId || named(r.DeviceProperties, "SessionId")),
  },
  "Correlation ID": { width: 280, read: (r: Raw) => r.correlationId },

  "Record ID": { width: 280, read: (r: Raw) => r.id ?? r.Id },
}

/** Which export fills a column in. Everything not named here is in both, so a
column is listed once, under the format that is alone in having it. */
export const kindColumns = {
  "sign-in": [
    "Client",
    "Authentication Requirement",
    "Authentication Details",
    "Conditional Access",
    "Conditional Access Policies",
    "Resource",
    "Resource ID",
    "Device",
    "OS",
    "Browser",
    "Device ID",
    "User-Agent",
    "Session ID",
  ],
  audit: [
    "Activity",
    "Category",
    "Service",
    "Target",
    "Target Type",
    "Target ID",
    "Modified Properties",
    "Additional Details",
  ],
  // Purview overlaps both of the others: it says what was done, the way an
  // audit export does, and where from on what, the way a sign-in export does.
  // A column listed under more than one kind is shown while any of them is.
  purview: [
    "Client",
    "Device",
    "OS",
    "Browser",
    "Device ID",
    "User-Agent",
    "Session ID",
    "Activity",
    "Workload",
    "Mailbox",
    "Parameters",
  ],
} as const

export type LogKind = keyof typeof kindColumns

export const logKinds = Object.keys(kindColumns) as Array<LogKind>

/** Which export a record came out of. Only a Purview record names the workload,
and of the two left only an audit record names the activity it logged. Read per
record rather than per file, because a file this app wrote holds whatever was on
the table, which is more than one kind as often as not. */
export const kindOf = (row: LogRow): LogKind =>
  // Truthiness rather than a comparison: a file this app wrote before Purview
  // was read has no `Workload` on its rows at all, and every one of them is
  // still a sign-in or an audit record.
  row.Workload ? "purview" : row.Activity ? "audit" : "sign-in"

/** The kinds a file holds, in the order the switches are drawn in. */
export const kindsIn = (rows: Array<LogRow>): Array<LogKind> =>
  logKinds.filter((kind) => rows.some((row) => kindOf(row) === kind))

export const textColumns = Object.keys(fields) as Array<keyof typeof fields>

export const detailColumns = Object.keys(detailFields) as Array<
  keyof typeof detailFields
>

const widths = new Map<string, number>(
  Object.entries({ ...fields, ...detailFields }).map(([label, column]) => [
    label,
    column.width,
  ])
)

/** The fixed width a column lays out at. */
export const columnWidth = (label: string) => widths.get(label) ?? 200

const units = new Map<string, string>(
  Object.entries(detailFields).map(([label, column]) => [label, column.unit])
)

/** What an expandable cell counts: `3 policies`, `2 changes`. */
export const detailUnit = (label: string) => units.get(label) ?? "items"

export type LogRow = Record<keyof typeof fields, string> &
  Record<keyof typeof detailFields, Detail[]>

/** Accepts a Graph sign-in or audit export: a bare array, or `{ value: [...] }`. */
const recordsIn = (parsed: Raw | null): Raw[] => {
  const records = Array.isArray(parsed) ? parsed : parsed?.value
  if (!Array.isArray(records)) {
    throw new Error("Expected an array of records.")
  }
  return records
}

/** What a load came out with: the rows, and what the file already knew about
their addresses. A Graph export knows nothing, so that list is empty. */
export type Loaded = { rows: Array<LogRow>; ips: Array<IpInfo> }

/** A file this app wrote, read back: rows that went through `readRecord`
already, under the key that marks the file as ours. */
const exported = (parsed: Raw | null): Loaded | undefined =>
  Array.isArray(parsed?.atlas)
    ? { rows: parsed.atlas, ips: Array.isArray(parsed.ips) ? parsed.ips : [] }
    : undefined

/** Rows as a file this app loads again without parsing or looking anything up
a second time. Everything a row carries is a string or a plain object, so the
rows go out as they sit in memory, with whatever ProxyCheck had said about their
addresses beside them. */
export const exportRows = (rows: Array<LogRow>, ips: Array<IpInfo>) => {
  try {
    return JSON.stringify({ atlas: rows, ips })
  } catch (cause) {
    // V8 will not hold a string past about half a gigabyte, which a few hundred
    // thousand records reaches. What it throws is a bare RangeError, so this
    // says which records and what to do about it instead.
    throw new Error(
      `${rows.length.toLocaleString()} records are too many to write to one file. Hide a file or narrow the search, then export again.`,
      { cause }
    )
  }
}

/** The two column lists, walked once at module load rather than rebuilt per
record. `Object.entries` twice plus `Object.fromEntries` twice was most of the
time a 300k row export spent in here, and it is the part that blocks between
yields. */
const plainReaders = Object.entries(fields)
const detailReaders = Object.entries(detailFields)

const readRecord = (record: Raw) => {
  const row: Record<string, unknown> = {}
  for (const [label, column] of plainReaders) {
    row[label] = String(column.read(record) ?? "")
  }
  for (const [label, column] of detailReaders) {
    row[label] = column.read(record)
  }
  return row as LogRow
}

/** Which of the three export shapes a file is, as the records to read, how to
read one, and whatever it already knows about its addresses. A Graph export
holds raw records; a Purview export holds records still carrying their audit
JSON; a file this app wrote holds rows that went through `readRecord` already,
which is why reading one of those is a cast.

One place, because both parses below branch on it and a fourth shape should not
have to be added to two of them. */
const sourceOf = (
  source: string
): {
  records: Array<Raw>
  read: (record: Raw) => LogRow
  ips: Array<IpInfo>
} => {
  if (isPurviewExport(source)) {
    return {
      records: purviewRecords(source),
      read: (record) => readRecord(purviewRecord(record)),
      ips: [],
    }
  }
  const parsed = JSON.parse(source)
  const already = exported(parsed)
  if (already === undefined) {
    return { records: recordsIn(parsed), read: readRecord, ips: [] }
  }
  return {
    records: already.rows,
    read: (row) => row as LogRow,
    ips: already.ips,
  }
}

/** The whole parse at once, which is what a test wants. `Application` comes out
empty for a record that carries only an id, unless `loadAppNames` was awaited
first; the app itself goes through `parseRecordsInSlices`, which does that. */
export function parseRecords(source: string): LogRow[] {
  const { records, read } = sourceOf(source)
  return records.map(read)
}

/** Records read per slice. One slice of this size is a frame or two of work. */
const sliceSize = 1000

/** Hands the thread back between slices. Not `setTimeout`: nested past five
levels it clamps to 4ms, and a big export is a few hundred slices, so the load
sat waiting for about a second in total. `scheduler.yield` has no clamp, and a
message round trip is the fallback where it is missing. */
const handBack = (): Promise<void> => {
  const scheduler = (
    globalThis as { scheduler?: { yield?: () => Promise<void> } }
  ).scheduler
  if (typeof scheduler?.yield === "function") return scheduler.yield()
  return new Promise((resume) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resume()
    }
    channel.port2.postMessage(null)
  })
}

/** The same parse, in slices, handing the thread back between them. A 350MB
export is a couple of seconds of work, and the page has to stay alive and
repaint its progress while that runs. `onSlice` sees each slice as it lands.

ponytail: `JSON.parse` itself still blocks, half a second on that same export.
Splitting that too means a streaming parser, which is a dependency and a rewrite
of this function. */
export async function parseRecordsInSlices(
  source: string,
  onSlice: (rows: Array<LogRow>, done: number, total: number) => void
): Promise<Loaded> {
  // Before any record is read: the `Application` column reads this list, and a
  // row is built once and then kept.
  await loadAppNames()
  const { records, read, ips } = sourceOf(source)
  const rows: Array<LogRow> = []
  for (let start = 0; start < records.length; start += sliceSize) {
    const slice = records.slice(start, start + sliceSize).map(read)
    rows.push(...slice)
    onSlice(slice, rows.length, records.length)
    await handBack()
  }
  return { rows, ips }
}
