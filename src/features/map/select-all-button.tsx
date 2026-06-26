import { cn } from "@/lib/utils"

// The "Select all" / "Deselect all" link-button shared by the map's Users and
// Categories panels: a primary-tinted text button. Callers pass `className` for
// the small positioning differences between the two panels.
export function SelectAllButton({
  allSelected,
  onClick,
  className,
}: {
  allSelected: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-left text-xs font-medium text-primary hover:text-primary/80",
        className
      )}
    >
      {allSelected ? "Deselect all" : "Select all"}
    </button>
  )
}
