import type { Dispatch, SetStateAction } from "react"
import {
  IconDownload,
  IconEye,
  IconEyeOff,
  IconFiles,
  IconFileUpload,
  IconJson,
  IconTrash,
} from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
} from "@/components/ui/item"
import { many } from "@/lib/analysis"
import { exportRows } from "@/lib/entra-logs"
import type { LogRow } from "@/lib/entra-logs"
import { knownIps } from "@/lib/ip-lookup"
import type { LoadedFile } from "@/lib/load-files"

/** Hands the browser a file it never fetched. The link is thrown away with the
url behind it, which is the whole of the download. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" })
  )
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function FileManager({
  files,
  setFiles,
  onAdd,
  rows,
}: {
  files: Array<LoadedFile>
  setFiles: Dispatch<SetStateAction<Array<LoadedFile>>>
  onAdd: () => void
  rows: Array<LogRow>
}) {
  const update = (id: string, patch: Partial<LoadedFile>) =>
    setFiles((current) =>
      current.map((file) => (file.id === id ? { ...file, ...patch } : file))
    )

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="ghost">
            <IconFiles data-icon="inline-start" />
            Files
            <Badge variant="secondary" className="tabular-nums">
              {files.length}
            </Badge>
          </Button>
        }
      />
      {/* Without this the dialog opens with a cursor parked in the first name. */}
      <DialogContent
        initialFocus={false}
        className="max-w-[min(32rem,calc(100%-2rem))] sm:max-w-[32rem]"
      >
        <DialogHeader>
          <DialogTitle>Files</DialogTitle>
        </DialogHeader>
        <ItemGroup className="gap-0.5 has-data-[size=sm]:gap-0.5">
          {files.map((file) => (
            <Item
              key={file.id}
              size="sm"
              className={file.hidden ? "opacity-50" : undefined}
            >
              <ItemMedia variant="icon">
                <IconJson />
              </ItemMedia>
              <ItemContent className="min-w-0 flex-row items-center gap-2">
                <Input
                  variant="ghost"
                  aria-label="File name"
                  title={file.name}
                  value={file.name}
                  onChange={(event) =>
                    update(file.id, { name: event.target.value })
                  }
                  className="h-6 min-w-0 flex-1 px-1 font-medium"
                />
                <ItemDescription className="shrink-0">
                  {many(file.rows.length, "record")}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={file.hidden ? "Show in table" : "Hide from table"}
                  onClick={() => update(file.id, { hidden: !file.hidden })}
                >
                  {file.hidden ? <IconEyeOff /> : <IconEye />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${file.name}`}
                  onClick={() =>
                    setFiles((current) =>
                      current.filter((other) => other.id !== file.id)
                    )
                  }
                >
                  <IconTrash />
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onAdd}>
            <IconFileUpload data-icon="inline-start" />
            Add files
          </Button>
          {/* The records as this app holds them, which it loads straight back
          in. What comes out is what is on the table: a hidden file and a
          switched-off export are both off it, so both stay out of the file. */}
          <Button
            variant="outline"
            className="flex-1"
            disabled={rows.length === 0}
            title={`${rows.length.toLocaleString()} records on the table`}
            onClick={() => {
              try {
                download(
                  `atlas-${rows.length}-records.json`,
                  exportRows(
                    rows,
                    knownIps(rows.map((row) => row["IP Address"]))
                  )
                )
              } catch (cause) {
                // Past a few hundred thousand records the whole file is more
                // string than the engine will hold, and the click did nothing
                // and said nothing.
                toast.add({
                  type: "error",
                  title: "The export could not be written",
                  description:
                    cause instanceof Error ? cause.message : String(cause),
                  timeout: 0,
                })
              }
            }}
          >
            <IconDownload data-icon="inline-start" />
            Export
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
