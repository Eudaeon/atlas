import { useSyncExternalStore } from "react"

import { ipInfoVersion, subscribeIpInfo } from "@/lib/ip-lookup"

/** Repaints the caller as lookups land. The number it returns only ever goes
up, so it is what a memo hangs off to rebuild itself when a result arrives; a
component that reads the store directly can ignore it and just subscribe.

Server renders start at zero, because there is nothing looked up there yet. */
export const useIpInfo = () =>
  useSyncExternalStore(subscribeIpInfo, ipInfoVersion, () => 0)
