// Minimal ambient types for the (untyped) `lucene` query parser. We only use
// `parse`; its AST is consumed in lib/table-query and typed there as LuceneNode.
declare module "lucene" {
  export function parse(query: string): unknown
  export function toString(ast: unknown): string
}
