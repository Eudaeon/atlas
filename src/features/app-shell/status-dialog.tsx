import { TriangleAlert } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Spinner } from "@/components/ui/spinner"

type StatusDialogProps = {
  parsing: boolean
  error: string | null
  onDismissError: () => void
}

// Blocking dialog for the file read/parse step only: a spinner while the file is
// read and parsed, or a destructive error with a dismiss button if it can't be
// parsed (no data behind it). Enrichment runs afterwards in the background — the
// app is usable as soon as parsing finishes — and reports through the per-source
// progress toasts instead of here.
export function StatusDialog({
  parsing,
  error,
  onDismissError,
}: StatusDialogProps) {
  return (
    <AlertDialog open={parsing || !!error}>
      <AlertDialogContent>
        {/* Spinner/icon centred on top, text centred beneath it. A fixed layout
            rather than AlertDialogHeader's responsive grid, so the text stays put
            regardless of its length. */}
        <div className="flex flex-col items-center gap-4 text-center">
          <AlertDialogMedia
            className={cn(
              "mb-0",
              error && "bg-destructive/10 text-destructive"
            )}
          >
            {error ? <TriangleAlert /> : <Spinner className="size-8" />}
          </AlertDialogMedia>
          {error ? (
            <div className="flex flex-col gap-1">
              <AlertDialogTitle>Couldn't load the file</AlertDialogTitle>
              <AlertDialogDescription className="text-pretty">
                {error}
              </AlertDialogDescription>
            </div>
          ) : (
            <AlertDialogTitle>Reading file…</AlertDialogTitle>
          )}
        </div>
        {error ? (
          <AlertDialogFooter>
            <AlertDialogAction variant="outline" onClick={onDismissError}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  )
}
