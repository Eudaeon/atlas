import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

// The shared shell every data view sits in: a centred, vertically-stacked column
// at a consistent width. Most views cap at max-w-5xl so their cards stay
// readable; `wide` opts out for the table, which needs the full viewport width.
export function ViewContainer({
  wide = false,
  className,
  children,
}: {
  wide?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex w-[90vw] flex-col gap-4",
        !wide && "max-w-5xl",
        className
      )}
    >
      {children}
    </div>
  )
}

// A view's heading row: the title on the left and optional controls (a count, a
// filter bar) on the right, wrapping to their own line on narrow screens.
export function ViewHeader({
  title,
  children,
}: {
  title: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <h1 className="text-lg font-medium">{title}</h1>
      {children}
    </div>
  )
}
