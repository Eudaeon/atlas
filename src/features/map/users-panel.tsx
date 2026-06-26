import { Users } from "lucide-react"

import { cn } from "@/lib/utils"
import { quantity } from "@/lib/format"
import type { UserEntry } from "@/lib/facets"
import { PanelTab } from "@/features/map/panel-tab"
import { SelectAllButton } from "@/features/map/select-all-button"

type UsersPanelProps = {
  users: UserEntry[]
  hidden: Set<string>
  colorFor: (user: string) => string
  onToggle: (user: string) => void
  onToggleAll: (select: boolean) => void
  open: boolean
  onToggleOpen: () => void
}

const TAB_ICON = <Users className="size-4" />

// Middle-left legend listing every user with their colour. Clicking a user
// toggles whether their connections are drawn on the map.
export function UsersPanel({
  users,
  hidden,
  colorFor,
  onToggle,
  onToggleAll,
  open,
  onToggleOpen,
}: UsersPanelProps) {
  const allSelected = users.every((u) => !hidden.has(u.label))
  const shown = users.filter((u) => !hidden.has(u.label)).length

  return (
    <div
      className={cn(
        "absolute top-1/2 left-0 z-10 flex max-h-[70vh] w-64 -translate-y-1/2 flex-col rounded-2xl bg-popover text-popover-foreground ring-1 ring-foreground/5 transition-transform duration-300 ease-out dark:ring-foreground/10",
        open ? "translate-x-4 shadow-lg" : "-translate-x-full"
      )}
    >
      <PanelTab
        side="left"
        label="USERS"
        icon={TAB_ICON}
        open={open}
        onToggle={onToggleOpen}
        shortcut="1"
      />
      <div className="flex flex-col gap-1 px-3 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium">Users</span>
          <span className="text-xs text-muted-foreground">
            Showing {quantity(shown, "user")}
          </span>
        </div>
        <SelectAllButton
          allSelected={allSelected}
          onClick={() => onToggleAll(!allSelected)}
          className="self-start"
        />
      </div>
      <div className="flex flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {users.map((user) => {
          const isHidden = hidden.has(user.label)
          return (
            <button
              key={user.label}
              type="button"
              onClick={() => onToggle(user.label)}
              aria-pressed={!isHidden}
              className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-muted"
            >
              <span
                className={cn(
                  "size-2.5 shrink-0 rounded-full ring-1 ring-black/10",
                  isHidden && "opacity-30"
                )}
                style={{ backgroundColor: colorFor(user.label) }}
              />
              <span
                className={cn(
                  "flex min-w-0 flex-col",
                  isHidden && "text-muted-foreground line-through"
                )}
              >
                <span className="scrollbar-hide overflow-x-auto text-xs font-medium whitespace-nowrap">
                  {user.name}
                </span>
                {user.email && user.email !== user.name ? (
                  <span className="scrollbar-hide overflow-x-auto text-xs whitespace-nowrap text-muted-foreground">
                    {user.email}
                  </span>
                ) : null}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
