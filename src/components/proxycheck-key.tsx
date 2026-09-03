import { useState } from "react"
import { IconTrash, IconWorldSearch } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { proxycheckKeys, setProxycheckKeys } from "@/lib/ip-lookup"

/** The ProxyCheck API keys the lookups are made with. A request carries up to a
hundred addresses and each of them counts against the day's allowance, so a run
over a big export gets through one key's thousand: hold several and the batch a
spent key hands back goes to the next one. */
export function ProxycheckKey({
  open,
  setOpen,
}: {
  open: boolean
  setOpen: (open: boolean) => void
}) {
  // Whatever was saved last time, so a reload only asks once. One to a line,
  // which is how they go back into the box as much as how they come out of it.
  const [keys, setKeys] = useState(() => proxycheckKeys().join("\n"))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="ProxyCheck API keys"
                >
                  <IconWorldSearch />
                </Button>
              }
            />
          }
        />
        <TooltipContent>ProxyCheck API keys</TooltipContent>
      </Tooltip>
      <DialogContent className="max-w-[min(32rem,calc(100%-2rem))] sm:max-w-[32rem]">
        <DialogHeader>
          <DialogTitle>ProxyCheck API keys</DialogTitle>
          <DialogDescription>
            A free key from{" "}
            <a href="https://proxycheck.io" target="_blank" rel="noreferrer">
              ProxyCheck.io
            </a>{" "}
            covers a thousand addresses a day. Hold more than one, a key to a
            line, and a run carries on down them as each is spent.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            setProxycheckKeys(keys)
            // The dialog stays mounted, so the box it reopens on has to say
            // what was actually saved, which is the keys and not the spacing.
            setKeys(proxycheckKeys().join("\n"))
            setOpen(false)
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="proxycheck-key">API keys</FieldLabel>
              <Textarea
                id="proxycheck-key"
                rows={3}
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  "111111-222222-333333-444444\n555555-666666-777777-888888"
                }
                value={keys}
                onChange={(event) => setKeys(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            {/* Clears as it saves, rather than leaving an empty box that Save
            refuses to submit. */}
            <Button
              type="button"
              variant="destructive"
              disabled={keys === ""}
              onClick={() => {
                setKeys("")
                setProxycheckKeys("")
              }}
            >
              <IconTrash data-icon="inline-start" />
              Remove
            </Button>
            <Button type="submit" disabled={keys.trim() === ""}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
