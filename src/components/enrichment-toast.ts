import { toast } from "@/components/ui/toast"
import { pauseLookups, resumeLookups } from "@/lib/ip-lookup"
import type { LookupProgress } from "@/lib/ip-lookup"

// One toast for the whole run, however many uploads feed it. It lives as long
// as the queue does, which for a long export is a batch at a time for a while,
// so it carries the pause button rather than a plain bar.
let enrichToast: string | undefined

function closeEnrichment() {
  if (enrichToast !== undefined) toast.close(enrichToast)
  enrichToast = undefined
}

/** What `lookupIps` reports its progress to. */
export function showEnrichment({ done, total, paused, error }: LookupProgress) {
  if (error !== undefined) {
    closeEnrichment()
    toast.add({
      type: "error",
      title: "IP enrichment failed",
      description: error,
    })
    return
  }
  if (done === total) {
    closeEnrichment()
    return
  }
  const content = {
    type: paused ? "info" : "loading",
    title: "Enriching IP addresses",
    description: `${done} of ${total}`,
    timeout: 0,
    actionProps: {
      children: paused ? "Resume" : "Pause",
      onClick: paused ? resumeLookups : pauseLookups,
    },
  }
  if (enrichToast === undefined) enrichToast = toast.add(content)
  else toast.update(enrichToast, content)
}
