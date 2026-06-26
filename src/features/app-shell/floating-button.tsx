import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

// An icon button that floats over the content (the theme toggle and the
// toolbar's actions): a solid card surface with a soft ring so it stays legible
// above whatever view it sits on top of. In dark mode the plain card surface is
// barely lighter than the app background, so we lift it to the secondary surface
// and use a brighter ring to keep the button's edge readable on a dark page.
// Uses the ghost variant (no border) so the ring is the only edge — the outline
// variant would re-impose border-border on top of it.
export function FloatingButton({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "bg-card shadow-md ring-1 ring-foreground/5",
        "dark:bg-secondary dark:ring-foreground/20 dark:hover:bg-accent",
        className
      )}
      {...props}
    />
  )
}
