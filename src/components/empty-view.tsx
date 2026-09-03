import type { ReactNode } from "react"
import type { Icon as TablerIcon } from "@tabler/icons-react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

/** What a view says when it has nothing to draw: a picture, what is missing,
and what to do about it. Sized and centred to stand where the view would have
been, so switching to an empty one lands on this rather than on a blank page. */
export function EmptyView({
  icon: Icon,
  title,
  children,
}: {
  icon: TablerIcon
  title: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <Empty className="w-auto flex-none rounded-xl border border-solid bg-muted">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="bg-input">
            <Icon />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{children}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
