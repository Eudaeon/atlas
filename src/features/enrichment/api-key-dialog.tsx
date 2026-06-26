import { useRef, useState } from "react"
import { KeyRound, Plus, Trash2, Upload, X } from "lucide-react"

import { getApiKeys, setApiKeys } from "@/lib/proxycheck"
import { getCrowdSecKeys, setCrowdSecKeys } from "@/lib/crowdsec"
import { cleanKeys, parseKeys } from "@/lib/key-pool"
import { Button } from "@/components/ui/button"
import { FloatingButton } from "@/features/app-shell/floating-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

type ApiKeyDialogProps = {
  apiKeys: string[]
  onApiKeysChange: (keys: string[]) => void
  crowdsecKeys: string[]
  onCrowdsecKeysChange: (keys: string[]) => void
  // Controlled open state, lifted to the app so other surfaces (e.g. the map's
  // no-locations empty state) can open the dialog, not just its own trigger.
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Always show at least one (empty) input so the list is never blank.
function withBlank(keys: string[]): string[] {
  return keys.length ? keys : [""]
}

// Drop later exact duplicates while keeping the first occurrence of each key and
// any empty rows (so the row being typed into survives). Values are compared
// trimmed but kept as-is. Storage de-duplicates too; this collapses duplicates in
// the visible list as soon as a field is left, rather than only on save/reopen.
function dedupeDrafts(keys: string[]): string[] {
  const seen = new Set<string>()
  return keys.filter((key) => {
    const trimmed = key.trim()
    if (!trimmed) return true
    if (seen.has(trimmed)) return false
    seen.add(trimmed)
    return true
  })
}

// A provider's editable list of keys: one input per key, a remove button on each
// (kept off the last remaining row so there's always something to type into), an
// add button, a file upload (one key per line, merged in) and a clear-all. Empty
// rows are dropped on save.
function KeyFields({
  label,
  drafts,
  setDrafts,
}: {
  label: string
  drafts: string[]
  setDrafts: (keys: string[]) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  async function loadFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    const fromFile = parseKeys(await file.text())
    // Merge the file's keys in after the ones already typed, de-duplicated.
    setDrafts(withBlank(cleanKeys([...drafts, ...fromFile])))
  }

  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="grid gap-2">
        {drafts.map((value, index) => (
          <div key={index} className="flex gap-2">
            <Input
              value={value}
              onChange={(event) =>
                setDrafts(
                  drafts.map((draft, i) =>
                    i === index ? event.target.value : draft
                  )
                )
              }
              // Collapse any duplicate this field just created, once the user
              // leaves it (doing so mid-typing would yank the row away).
              onBlur={() => setDrafts(withBlank(dedupeDrafts(drafts)))}
              placeholder="Optional"
              aria-label={`${label} ${index + 1}`}
              autoComplete="off"
              spellCheck={false}
            />
            {drafts.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                aria-label={`Remove ${label} ${index + 1}`}
                onClick={() => setDrafts(drafts.filter((_, i) => i !== index))}
              >
                <X />
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setDrafts([...drafts, ""])}
        >
          <Plus />
          Add key
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
        >
          <Upload />
          Upload
        </Button>
        {/* Disabled when there's nothing to clear (a single blank row). */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto text-muted-foreground"
          disabled={cleanKeys(drafts).length === 0}
          onClick={() => setDrafts([""])}
        >
          <Trash2 />
          Clear all
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="text/plain,.txt,.csv,.text"
          className="hidden"
          aria-label={`Upload ${label} from file`}
          onChange={loadFile}
        />
      </div>
    </div>
  )
}

export function ApiKeyDialog({
  apiKeys,
  onApiKeysChange,
  crowdsecKeys,
  onCrowdsecKeysChange,
  open,
  onOpenChange,
}: ApiKeyDialogProps) {
  const [proxyDrafts, setProxyDrafts] = useState(() => withBlank(apiKeys))
  const [crowdsecDrafts, setCrowdsecDrafts] = useState(() =>
    withBlank(crowdsecKeys)
  )

  function handleOpenChange(next: boolean) {
    if (next) {
      setProxyDrafts(withBlank(getApiKeys()))
      setCrowdsecDrafts(withBlank(getCrowdSecKeys()))
    }
    onOpenChange(next)
  }

  // Persist both lists (storage trims, de-duplicates and drops blanks), then
  // notify the app so each source re-enriches any IPs it is still missing.
  function commit() {
    setApiKeys(proxyDrafts)
    onApiKeysChange(getApiKeys())
    setCrowdSecKeys(crowdsecDrafts)
    onCrowdsecKeysChange(getCrowdSecKeys())
    onOpenChange(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger
        render={
          <FloatingButton
            className="fixed top-4 left-4 z-50"
            aria-label="Set enrichment API keys"
          />
        }
      >
        <KeyRound />
      </AlertDialogTrigger>
      <AlertDialogContent className="flex max-h-[85vh] flex-col">
        <AlertDialogHeader>
          <AlertDialogTitle>Enrichment API keys</AlertDialogTitle>
          <AlertDialogDescription>
            Atlas looks up each source IP through{" "}
            <a
              href="https://proxycheck.io/"
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-4"
            >
              ProxyCheck.io
            </a>{" "}
            (location and network) and{" "}
            <a
              href="https://www.crowdsec.net/"
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-4"
            >
              CrowdSec
            </a>{" "}
            (risk and threat data). Keys are optional and stored only in this
            browser. Add more than one key for a source to spread the lookups
            across them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {/* The key lists can grow long, so this scrolls within the bounded
            dialog while the header and footer stay put. */}
        <form
          className="-mr-2 grid min-h-0 flex-1 gap-5 overflow-y-auto pr-2"
          onSubmit={(event) => {
            event.preventDefault()
            commit()
          }}
        >
          <KeyFields
            label="ProxyCheck.io keys"
            drafts={proxyDrafts}
            setDrafts={setProxyDrafts}
          />
          <KeyFields
            label="CrowdSec CTI keys"
            drafts={crowdsecDrafts}
            setDrafts={setCrowdsecDrafts}
          />
        </form>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={commit}>Save</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
