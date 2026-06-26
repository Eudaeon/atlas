import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ViewContainer, ViewHeader } from "@/features/app-shell/view-container"
import type { View } from "@/features/app-shell/views"

// A card placeholder matching the stat/finding cards: a header (title over an
// optional sub-line) above a body block sized by the caller.
function CardSkeleton({ body }: { body: string }) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-48" />
      </CardHeader>
      <CardContent>
        <Skeleton className={cn("w-full", body)} />
      </CardContent>
    </Card>
  )
}

// The table view: a count heading, the search + columns toolbar, then a bordered
// grid of rows.
function TableSkeleton() {
  return (
    <ViewContainer wide>
      <ViewHeader title={<Skeleton className="h-6 w-28" />} />
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 max-w-sm flex-1" />
          <Skeleton className="ml-auto h-8 w-24" />
        </div>
        <div className="overflow-hidden rounded-lg border">
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "flex items-center gap-4 px-4 py-3",
                i > 0 && "border-t border-border"
              )}
            >
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="hidden h-4 w-44 sm:block" />
              <Skeleton className="ml-auto h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </ViewContainer>
  )
}

// The statistics view: heading + count, the filter bar, a full-width timeline
// card, then a two-column grid of chart cards.
function StatisticsSkeleton() {
  return (
    <ViewContainer>
      <ViewHeader title={<Skeleton className="h-6 w-28" />}>
        <Skeleton className="h-5 w-20" />
      </ViewHeader>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-36" />
      </div>
      <CardSkeleton body="h-[240px]" />
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardSkeleton key={i} body="h-[200px]" />
        ))}
      </div>
    </ViewContainer>
  )
}

// The analysis view: heading + severity filters, then a stack of finding cards
// (title + severity badge, a couple of text lines, and an action button).
function AnalysisSkeleton() {
  return (
    <ViewContainer>
      <ViewHeader title={<Skeleton className="h-6 w-28" />}>
        <div className="flex gap-2">
          <Skeleton className="h-7 w-14" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-24" />
        </div>
      </ViewHeader>
      <div className="flex flex-col gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-5 w-16" />
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-8 w-44" />
            </CardContent>
          </Card>
        ))}
      </div>
    </ViewContainer>
  )
}

// The map view is a full-bleed canvas, so its placeholder is one large block.
function MapSkeleton() {
  return (
    <ViewContainer wide>
      <Skeleton className="h-[75vh] w-full" />
    </ViewContainer>
  )
}

// Shown while a lazily-loaded view's chunk is fetched. Renders a skeleton shaped
// like the incoming view so the switch settles into place instead of flashing a
// spinner and then reflowing.
export function ViewFallback({ view }: { view: View }) {
  switch (view) {
    case "table":
      return <TableSkeleton />
    case "statistics":
      return <StatisticsSkeleton />
    case "map":
      return <MapSkeleton />
    case "analysis":
      return <AnalysisSkeleton />
  }
}
