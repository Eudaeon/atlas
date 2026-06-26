import { useState } from "react"
import { Link2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

// Opening a share link on the web is just visiting its `?id=` URL. The desktop
// app loads from `atlas://` with no query, so it offers a paste box instead: the
// pasted link (or bare id) goes through the same share-loading path as the web
// startup. `onOpen` is the hook's `openShare`, which surfaces its own toasts.
export function OpenShareDialog({
  onOpen,
}: {
  onOpen: (input: string) => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")

  function submit() {
    const input = value.trim()
    if (!input) return
    onOpen(input)
    setValue("")
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <Link2 />
        Open share link
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Open a share link</DialogTitle>
          <DialogDescription>
            Paste a share link or its ID to load the connections it points to.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="share-link">Share link</Label>
          <Input
            id="share-link"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit()
            }}
            placeholder="https://…/?id=… or an ID"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2">
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button onClick={submit} disabled={!value.trim()}>
            Open
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
