import { FileJson } from "lucide-react"

import { Button } from "@/components/ui/button"
import { EmptyCard } from "@/features/app-shell/empty-card"
import { OpenShareDialog } from "@/features/app-shell/open-share-dialog"

// The landing state shown before any data is loaded: what the app does and a
// button to pick a file. `openShare`, when given, adds a paste box for opening a
// share link — the desktop app's way in, since it can't open one by URL.
export function UploadEmptyState({
  onUpload,
  openShare,
}: {
  onUpload: () => void
  openShare?: (input: string) => Promise<void> | void
}) {
  return (
    <EmptyCard
      // flex-none so the card keeps its size in the centred landing column
      // rather than stretching to fill it.
      className="flex-none"
      icon={<FileJson />}
      title="No sign-ins loaded"
      description="Upload an Entra ID sign-in log (JSON) or a Microsoft Purview audit log (CSV). Atlas maps where each connection came from and lets you filter by user, category, and time."
    >
      <Button onClick={onUpload}>Upload sign-in log</Button>
      {openShare ? <OpenShareDialog onOpen={openShare} /> : null}
      <p className="text-xs text-muted-foreground">
        or drag a file onto the page
      </p>
    </EmptyCard>
  )
}
