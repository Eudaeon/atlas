import { KeyRound, MapPinOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import { EmptyCard } from "@/features/app-shell/empty-card"

// Shown in place of the map when no sign-in resolved to coordinates, so the user
// sees an explanation rather than a blank globe. `onConfigureKeys`, when given,
// adds a button that opens the enrichment key dialog — the action the
// description asks for, instead of leaving the user to hunt for the key icon.
export function MapEmptyState({
  onConfigureKeys,
}: {
  onConfigureKeys?: () => void
}) {
  return (
    <div className="fixed inset-0 flex items-center justify-center p-4">
      <EmptyCard
        icon={<MapPinOff />}
        title="No locations to map"
        description="No sign-in resolved to a location. Add a ProxyCheck API key to look up where each IP is."
      >
        {onConfigureKeys ? (
          <Button onClick={onConfigureKeys}>
            <KeyRound />
            Add API keys
          </Button>
        ) : null}
      </EmptyCard>
    </div>
  )
}
