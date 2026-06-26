// The sign-in table's search uses Lucene query syntax, parsed by the `lucene`
// package and evaluated here against each row. Lucene is the established language
// for exactly this kind of faceted, field-scoped search, so the table gets the
// full set of "complex" queries for free:
//
//   foo                          any column contains "foo"
//   "foo bar"                    any column contains the phrase
//   country:France               one field
//   country:"United States"      quoted value
//   status:(Success OR Failure)  one of (field-grouped OR)
//   -status:Failure / NOT x      exclude
//   score:>=3                    numeric comparison (> >= < <=)
//   score:[3 TO 5]               inclusive range ({ } for exclusive)
//   date:[2024-01-01 TO 2024-02-01]   dates compare chronologically
//   ip:77.88*                    wildcard (* many, ? one)
//   a AND b / a OR b / (a b) c   booleans and grouping
//
// Bare and field terms are case-insensitive substring matches. Field names are
// resolved through friendly aliases (see FIELD_ALIASES); an unknown or absent
// field degrades to a global term so a stray "http://x" still searches sensibly.

import { parse } from "lucene"

// Friendly aliases onto the table's column labels. Several aliases can point at
// the same column; the column's own label (normalised, see normaliseField) always
// works too, so "ipaddress:" matches as well as "ip:".
const FIELD_ALIASES: Record<string, string> = {
  id: "Request ID",
  request: "Request ID",
  date: "Date",
  time: "Date",
  name: "Name",
  user: "Name",
  email: "Email",
  upn: "Email",
  app: "Application",
  appid: "Application ID",
  ip: "IP Address",
  client: "Client",
  ua: "User Agent",
  useragent: "User Agent",
  auth: "Authentication Requirement",
  mfa: "Authentication Requirement",
  status: "Status",
  reason: "Failure Reason",
  failure: "Failure Reason",
  device: "Device",
  deviceid: "Device ID",
  os: "OS",
  browser: "Browser",
  provider: "Provider",
  org: "Organization",
  organisation: "Organization",
  organization: "Organization",
  type: "Type",
  continent: "Continent",
  country: "Country",
  lat: "Latitude",
  latitude: "Latitude",
  lng: "Longitude",
  lon: "Longitude",
  longitude: "Longitude",
  detections: "Detections",
  operator: "Operator",
  rep: "Reputation",
  reputation: "Reputation",
  score: "Threat Score",
  threat: "Threat Score",
}

// The shape of the nodes `lucene` produces. A node is one of: empty ({} — an
// empty query), a leaf term (term, or term_min/term_max for a range), or a
// boolean node (left, operator, right) which may itself carry a field when a
// group is field-scoped, e.g. status:(a OR b). `start: "NOT"` negates a child.
type LuceneNode = {
  field?: string
  term?: string
  term_min?: string
  term_max?: string
  inclusive?: "both" | "left" | "right" | "none"
  quoted?: boolean
  prefix?: string | null
  left?: LuceneNode
  right?: LuceneNode
  operator?: string
  start?: string
}

// Strip a field token down to its comparable core: lower-case, letters and
// digits only. "IP Address" and "ip" both reduce so aliases line up.
function normaliseField(field: string): string {
  return field.toLowerCase().replace(/[^a-z0-9]/g, "")
}

// Resolve the labels actually present in the table into a lookup from every
// accepted field token (normalised label + any aliases pointing at a present
// label) to that label.
function buildFieldIndex(labels: string[]): Map<string, string> {
  const present = new Set(labels)
  const index = new Map<string, string>()
  for (const label of labels) index.set(normaliseField(label), label)
  for (const [alias, label] of Object.entries(FIELD_ALIASES)) {
    if (present.has(label)) index.set(normaliseField(alias), label)
  }
  return index
}

// Compare two raw cell strings for an ordering operator/range. Dates compare
// chronologically, otherwise a numeric compare when both look numeric, otherwise
// a locale string compare. Returns NaN when the values aren't comparable (so the
// term simply doesn't match).
function compare(cell: string, query: string, isDate: boolean): number {
  if (isDate) {
    const a = Date.parse(cell)
    const b = Date.parse(query)
    if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN
    return a - b
  }
  const a = Number(cell)
  const b = Number(query)
  if (!Number.isNaN(a) && !Number.isNaN(b) && cell.trim() !== "") return a - b
  return cell.localeCompare(query, undefined, { numeric: true })
}

// Turn a wildcard term (* = any run, ? = one char) into an anchored, case-
// insensitive RegExp, escaping the other regex metacharacters.
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  const body = escaped.replace(/\*/g, ".*").replace(/\?/g, ".")
  return new RegExp(`^${body}$`, "i")
}

// Build the predicate one leaf term applies to a single cell string. `isDate`
// selects chronological comparison for range/relational operators.
function cellTest(
  node: LuceneNode
): (cell: string, isDate: boolean) => boolean {
  // Range: term_min/term_max with inclusivity. "*" is an open bound.
  if (node.term_min !== undefined || node.term_max !== undefined) {
    const { term_min: min, term_max: max } = node
    const leftIncl = node.inclusive === "both" || node.inclusive === "left"
    const rightIncl = node.inclusive === "both" || node.inclusive === "right"
    return (cell, isDate) => {
      if (min !== undefined && min !== "*") {
        const c = compare(cell, min, isDate)
        if (Number.isNaN(c) || (leftIncl ? c < 0 : c <= 0)) return false
      }
      if (max !== undefined && max !== "*") {
        const c = compare(cell, max, isDate)
        if (Number.isNaN(c) || (rightIncl ? c > 0 : c >= 0)) return false
      }
      return true
    }
  }

  const term = node.term ?? ""

  // Relational comparison, e.g. >=3.
  const rel = /^(>=|<=|>|<)(.+)$/.exec(term)
  if (rel) {
    const [, op, operand] = rel
    return (cell, isDate) => {
      const c = compare(cell, operand, isDate)
      if (Number.isNaN(c)) return false
      if (op === ">") return c > 0
      if (op === ">=") return c >= 0
      if (op === "<") return c < 0
      return c <= 0
    }
  }

  // Wildcard (unquoted * or ?), otherwise a plain case-insensitive substring.
  if (!node.quoted && /[*?]/.test(term)) {
    const re = wildcardToRegExp(term)
    return (cell) => re.test(cell)
  }
  const needle = term.toLowerCase()
  return (cell) => cell.toLowerCase().includes(needle)
}

// Evaluate one leaf term against the row. `inherited` is the field carried down
// from an enclosing group, e.g. status:(Success OR Failure). A leading "-" (on
// the field or as a term prefix) negates.
function evalTerm(
  node: LuceneNode,
  inherited: string | undefined,
  values: Record<string, string>,
  index: Map<string, string>
): boolean {
  let rawField = node.field
  let negate = node.prefix === "-"
  if (rawField === "<implicit>" || rawField === undefined) rawField = undefined
  if (rawField && (rawField.startsWith("-") || rawField.startsWith("+"))) {
    if (rawField.startsWith("-")) negate = !negate
    rawField = rawField.slice(1)
  }

  const fieldName = rawField ?? inherited
  const label = fieldName ? index.get(normaliseField(fieldName)) : undefined
  const test = cellTest(node)

  // A resolved field tests its one column; a global term (no field, or an
  // unrecognised one) tests every column.
  let hit: boolean
  if (label) {
    hit = test(values[label] ?? "", label === "Date")
  } else {
    hit = Object.values(values).some((cell) => test(cell, false))
  }
  return negate ? !hit : hit
}

function evalNode(
  node: LuceneNode | undefined,
  inherited: string | undefined,
  values: Record<string, string>,
  index: Map<string, string>
): boolean {
  if (!node) return true
  if (
    node.term !== undefined ||
    node.term_min !== undefined ||
    node.term_max !== undefined
  ) {
    return evalTerm(node, inherited, values, index)
  }

  // A field on a boolean/group node (status:(a OR b)) propagates to its implicit
  // children.
  const groupField =
    node.field && node.field !== "<implicit>" ? node.field : inherited

  if (node.left && node.right && node.operator) {
    const left = evalNode(node.left, groupField, values, index)
    const right = evalNode(node.right, groupField, values, index)
    const op = node.operator
    const rightVal = op.endsWith("NOT") ? !right : right
    let result =
      op === "OR" || op === "OR NOT" ? left || rightVal : left && rightVal
    if (node.start === "NOT") result = !result
    return result
  }

  // A single wrapped child (the common top-level case, plus "NOT x").
  let result = evalNode(node.left, groupField, values, index)
  if (node.start === "NOT") result = !result
  return result
}

// A predicate over a row's column values (keyed by column label) for a given
// search string. Reads the query: every row matches the empty query.
export type RowMatcher = (values: Record<string, string>) => boolean

// Compile a raw search string against the table's available column labels into a
// row predicate, parsing once. The search is exclusively Lucene: a query that
// can't be parsed (e.g. mid-typing, an unclosed group) applies no filter, so the
// table stays usable and shows every row until the query becomes valid Lucene.
export function compileQuery(input: string, labels: string[]): RowMatcher {
  const trimmed = input.trim()
  if (!trimmed) return () => true

  const index = buildFieldIndex(labels)
  let ast: LuceneNode
  try {
    ast = parse(trimmed) as LuceneNode
  } catch {
    return () => true
  }
  return (values) => evalNode(ast, undefined, values, index)
}
