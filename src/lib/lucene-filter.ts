import { parse } from "lucene"
import type { AST, Node, NodeRangedTerm, NodeTerm } from "lucene"

import { detailColumns, textColumns } from "@/lib/entra-logs"
import type { Detail, LogRow } from "@/lib/entra-logs"
import { ipColumns, ipHaystack, ipValue, isIpColumn } from "@/lib/ip-columns"

const columns = [...textColumns, ...detailColumns]

/** Every column the table mounts, the ProxyCheck ones included, because those are
columns like any other to whoever is reading them. */
const searched = [...columns, ...ipColumns]

/** `Record ID` becomes `recordId`, `OS` becomes `os`, `User-Agent` becomes `userAgent`. */
const slug = (label: string) =>
  label
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word[0].toUpperCase() + word.slice(1).toLowerCase()
    )
    .join("")

/** Query field name to column label, so `ipAddress` reaches `IP Address`. */
export const luceneFields = new Map(
  searched.map((label) => [slug(label), label])
)

/** Expandable columns hold objects, so flatten them into one searchable string. */
const searchable = (value: string | Array<Detail>) =>
  typeof value === "string"
    ? value
    : value
        .map((detail) =>
          [detail.title, detail.subtitle, ...detail.entries.flat()].join(" ")
        )
        .join(" ")

/** One column of a row as text, whether it came out of the export or off the
lookup for its address. */
const valueOf = (row: LogRow, label: string) =>
  isIpColumn(label)
    ? ipValue(row, label)
    : searchable(row[label as keyof LogRow])

/** Every column of a row as one lowercased string, built once per row.

An unfielded term used to test every column one at a time, re-flattening the
detail columns and lowercasing every value on each keystroke. That was ~90ms per
keystroke on 20k rows. Joined on a newline, which a single-line search box
cannot contain, so no term can match across a column boundary. */
const haystacks = new WeakMap<LogRow, string>()
const haystack = (row: LogRow) => {
  let text = haystacks.get(row)
  if (text === undefined) {
    text = columns
      .map((column) => searchable(row[column]))
      .join("\n")
      .toLowerCase()
    haystacks.set(row, text)
  }
  return text
}

/** Builds the haystacks up front, so the first search is not the one that pays. */
export const indexRows = (rows: Array<LogRow>) => rows.forEach(haystack)

const isTerm = (node: Node): node is NodeTerm => "term" in node

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** What a quoted term is actually looking for. The parser leaves the escapes
in, so a name with a quote of its own arrives as `say \"hi\"`. */
const literal = (node: NodeTerm) =>
  node.quoted ? node.term.replace(/\\(.)/g, "$1") : node.term

/** The lowercased term, or null when it needs a regex: wildcards and `/re/`. */
const plainNeedle = (node: NodeTerm) =>
  !node.regex && (node.quoted || !/[*?]/.test(node.term))
    ? literal(node).toLowerCase()
    : null

/** Wildcards match a whole cell; every other term matches a substring. */
function termTest(node: NodeTerm) {
  const needle = plainNeedle(node)
  if (needle !== null) {
    return (value: string) => value.toLowerCase().includes(needle)
  }
  if (node.regex) {
    const pattern = new RegExp(node.term.replace(/^\/|\/$/g, ""), "i")
    return (value: string) => pattern.test(value)
  }
  const body = escape(node.term).replace(/\\\*/g, ".*").replace(/\\\?/g, ".")
  const pattern = new RegExp(`^${body}$`, "i")
  return (value: string) => pattern.test(value)
}

/** Numbers and dates compare by value, everything else as lowercased text. */
const sortKey = (value: string): number | string => {
  const number = Number(value)
  if (value.trim() !== "" && !Number.isNaN(number)) return number
  const time = Date.parse(value)
  return Number.isNaN(time) ? value.toLowerCase() : time
}

const compare = (value: string, bound: string) => {
  const [left, right] = [sortKey(value), sortKey(bound)]
  if (typeof left === "number" && typeof right === "number") return left - right
  const [a, b] = [value.toLowerCase(), bound.toLowerCase()]
  return a < b ? -1 : a > b ? 1 : 0
}

/** A day named as an inclusive upper bound means the end of that day. Dates
compare as instants, so `TO 2026-08-07` on its own is the midnight the day
starts at, and everything anyone did that day falls outside the range. */
const dayEnd = (bound: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(bound) ? `${bound}T23:59:59.999Z` : bound

function rangeTest(node: NodeRangedTerm) {
  const low = node.term_min === "*" ? null : node.term_min
  const includeLow = node.inclusive === "both" || node.inclusive === "left"
  const includeHigh = node.inclusive === "both" || node.inclusive === "right"
  const high =
    node.term_max === "*"
      ? null
      : includeHigh
        ? dayEnd(node.term_max)
        : node.term_max

  return (value: string) => {
    if (low !== null) {
      const order = compare(value, low)
      if (order < 0 || (order === 0 && !includeLow)) return false
    }
    if (high !== null) {
      const order = compare(value, high)
      if (order > 0 || (order === 0 && !includeHigh)) return false
    }
    return true
  }
}

function nodeTest(node: Node, inherited: string | undefined) {
  // `-os:Windows` parses the dash into the field name, `-windows` into a prefix.
  const named = node.field === "<implicit>" ? inherited : node.field
  const negatedField = named !== undefined && /^[-!]/.test(named)
  const name = negatedField ? named.slice(1) : named
  const label = name === undefined ? undefined : luceneFields.get(name)
  if (name !== undefined && label === undefined) {
    throw new Error(`Unknown field "${name}"`)
  }

  const test = isTerm(node) ? termTest(node) : rangeTest(node)
  const negate =
    negatedField ||
    (isTerm(node) && (node.prefix === "-" || node.prefix === "!"))
  // A plain term with no column named after it is one `includes` on the row's
  // haystack. Wildcards and regexes still go column by column, because they
  // anchor to a whole cell.
  const needle = isTerm(node) ? plainNeedle(node) : null
  const match = (row: LogRow) =>
    label !== undefined
      ? test(valueOf(row, label))
      : needle !== null
        ? haystack(row).includes(needle) || ipHaystack(row).includes(needle)
        : searched.some((column) => test(valueOf(row, column)))

  return (row: LogRow) => (negate ? !match(row) : match(row))
}

function astTest(
  ast: AST | Node,
  inherited?: string
): (row: LogRow) => boolean {
  if (!("left" in ast)) return nodeTest(ast, inherited)

  // `status:(Success OR Failure)` hangs the field on the group, not the terms.
  const field =
    ast.field !== undefined && ast.field !== "<implicit>"
      ? ast.field
      : inherited
  const left = astTest(ast.left, field)
  const first =
    "start" in ast && ast.start === "NOT" ? (row: LogRow) => !left(row) : left
  if (!("operator" in ast)) return first

  const right = astTest(ast.right, field)
  switch (ast.operator) {
    case "OR":
      return (row) => first(row) || right(row)
    case "OR NOT":
      return (row) => first(row) || !right(row)
    case "NOT":
    case "AND NOT":
      return (row) => first(row) && !right(row)
    default:
      // ponytail: two bare words mean AND, not Lucene's default OR. A log
      // search box that widens as you type is useless.
      return (row) => first(row) && right(row)
  }
}

/** Compiles a Lucene query. Throws on bad syntax or an unknown field name. */
export function compileQuery(query: string) {
  if (query.trim() === "") return () => true
  return astTest(parse(query))
}
