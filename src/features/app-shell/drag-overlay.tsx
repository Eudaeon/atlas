import { Upload } from "lucide-react"

// A full-window overlay shown while a file is being dragged over the app, making
// it clear the page will accept the drop. The window-level drag listeners (see
// useFileDrop) handle the drop itself; this is purely the visual cue, so it
// ignores pointer events and never intercepts the drop.
export function DragOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary/60 bg-card px-10 py-8 text-foreground shadow-lg">
        <Upload className="size-8 text-primary" />
        <p className="text-base font-medium">Drop to load sign-ins</p>
        <p className="text-sm text-muted-foreground">
          Entra ID sign-in log (JSON) or Purview audit log (CSV)
        </p>
      </div>
    </div>
  )
}
