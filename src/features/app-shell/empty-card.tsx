import type { ReactNode } from "react"

import { cn } from "@/lib/utils"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

// The full-page "nothing here yet" card shared by the upload landing state and
// the map's no-locations state: a large rounded icon, a title and description,
// and an optional action area beneath. Both states styled the same card by hand
// before; this keeps that treatment in one place.
export function EmptyCard({
  icon,
  title,
  description,
  className,
  children,
}: {
  icon: ReactNode
  title: ReactNode
  description: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <Empty
      className={cn(
        "w-full max-w-md rounded-2xl border-2 border-muted-foreground/30 bg-card shadow-md",
        className
      )}
    >
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-12 rounded-2xl">
          {icon}
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children ? <EmptyContent>{children}</EmptyContent> : null}
    </Empty>
  )
}
