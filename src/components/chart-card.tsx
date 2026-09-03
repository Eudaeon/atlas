import type { ReactNode } from "react"

import { cn } from "@/lib/utils"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

/** The frame a chart sits in: what it shows, an aside about it on the right,
and the chart itself under both. The palette, the axis colour and the tooltip
surface are handed to TanStack Charts in `styles.css`, on the `ts-chart-host`
class its adapter writes. */
export function ChartCard({
  title,
  aside,
  className,
  children,
}: {
  title: ReactNode
  aside?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <Card size="sm" className={cn("gap-3", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {aside === undefined ? null : (
          <CardAction className="text-muted-foreground">{aside}</CardAction>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
