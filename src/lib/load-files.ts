import { indexRows } from "@/lib/lucene-filter"
import { seedIpInfo } from "@/lib/ip-lookup"
import { kindOf, kindsIn, parseRecordsInSlices } from "@/lib/entra-logs"
import type { LogKind, LogRow } from "@/lib/entra-logs"

/** One loaded export: its rows, plus the name and visibility the user controls.
A file this app wrote can hold every kind, so this is a list rather than one. */
export type LoadedFile = {
  id: string
  name: string
  kinds: Array<LogKind>
  rows: Array<LogRow>
  hidden: boolean
}

/** The records on the table: the files that are shown, of the export kinds that
are switched on. Both switches read as filters, so they take records off the app
rather than columns off the table, and the export writes what is on the table. */
export const visibleRows = (files: Array<LoadedFile>, kinds: Array<LogKind>) =>
  files
    .filter((file) => !file.hidden)
    .flatMap((file) => file.rows)
    .filter((row) => kinds.includes(kindOf(row)))

/** Parses each file, keeping the ones that worked and a message for each that
did not. One bad file never costs the others. `onProgress` is called with the
file being read and how far through it we are, between 0 and 1. */
export async function loadFiles(
  files: Array<File>,
  onProgress: (name: string, done: number) => void = () => {}
) {
  const loaded: Array<LoadedFile> = []
  const failures: Array<string> = []
  for (const file of files) {
    try {
      const text = await file.text()
      const { rows, ips } = await parseRecordsInSlices(
        text,
        (slice, done, total) => {
          // Costs about as much as one search pass, and doing it a slice at a
          // time keeps it off the end of the load.
          indexRows(slice)
          onProgress(file.name, done / total)
        }
      )
      // A file this app wrote carries what ProxyCheck said about its addresses.
      // Handing that to the store before the rows go on screen is what saves
      // the whole run being made again.
      seedIpInfo(ips)
      loaded.push({
        id: crypto.randomUUID(),
        name: file.name,
        kinds: kindsIn(rows),
        rows,
        hidden: false,
      })
      console.info(
        `Loaded ${file.name}: ${rows.length} records, ${ips.length} known addresses`
      )
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      console.error(`Could not read ${file.name}: ${reason}`)
      failures.push(`${file.name}: ${reason}`)
    }
  }
  return { loaded, failures }
}
