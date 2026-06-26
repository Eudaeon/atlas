import { Share2, Upload } from "lucide-react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { FloatingButton } from "@/features/app-shell/floating-button"
import { VIEWS, type View } from "@/features/app-shell/views"

const VIEW_LABELS: Record<View, string> = {
  table: "Table",
  statistics: "Statistics",
  map: "Map",
  analysis: "Analysis",
}

function isView(value: string | undefined): value is View {
  return VIEWS.includes(value as View)
}

type ToolbarProps = {
  view: View
  onViewChange: (view: View) => void
  onUpload: () => void
  onShare: () => void
  // Hidden when false: the desktop build with sharing disabled has nowhere to
  // publish a link to. Defaults to shown.
  canShare?: boolean
}

// The fixed top toolbar shown once data is loaded: upload and share actions plus
// the view switcher.
export function Toolbar({
  view,
  onViewChange,
  onUpload,
  onShare,
  canShare = true,
}: ToolbarProps) {
  return (
    <div className="fixed top-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      <div className="flex items-center gap-2">
        <FloatingButton
          aria-label="Upload data"
          title="Upload data (U)"
          onClick={onUpload}
        >
          <Upload />
        </FloatingButton>
        {canShare ? (
          <FloatingButton
            aria-label="Share all data"
            title="Share all data (S)"
            onClick={onShare}
          >
            <Share2 />
          </FloatingButton>
        ) : null}
      </div>
      <ToggleGroup
        variant="outline"
        spacing={0}
        value={[view]}
        onValueChange={(value) => {
          const next = value[0]
          if (isView(next)) onViewChange(next)
        }}
        className="bg-card shadow-md"
      >
        {VIEWS.map((value) => (
          <ToggleGroupItem
            key={value}
            value={value}
            title={`${VIEW_LABELS[value]} view (V to switch)`}
            className="group-data-[spacing=0]/toggle-group:px-3.5"
          >
            {VIEW_LABELS[value]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
