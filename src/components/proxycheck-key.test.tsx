/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, test } from "vitest"

import { ProxycheckKey } from "@/components/proxycheck-key"
import { proxycheckKeys } from "@/lib/ip-lookup"

/** The ways the dialog changes what is saved rather than what is typed. The
saved keys are module state, so each test opens on what the one before it left
behind, which is what reopening the dialog does. */

afterEach(cleanup)

const box = () => screen.getByLabelText<HTMLTextAreaElement>("API keys")

test("saves the key without the whitespace around it", () => {
  render(<ProxycheckKey open setOpen={() => {}} />)

  fireEvent.change(box(), { target: { value: "  111111-222222  " } })
  fireEvent.click(screen.getByRole("button", { name: "Save" }))

  expect(proxycheckKeys()).toEqual(["111111-222222"])
  expect(box().value).toBe("111111-222222")
})

test("takes a key to a line, and saves them as a pool", () => {
  render(<ProxycheckKey open setOpen={() => {}} />)

  fireEvent.change(box(), {
    target: { value: " 111111-222222 \n\n 333333-444444 \n" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Save" }))

  expect(proxycheckKeys()).toEqual(["111111-222222", "333333-444444"])
  expect(box().value).toBe("111111-222222\n333333-444444")
})

test("remove empties the keys without waiting for a save", () => {
  render(<ProxycheckKey open setOpen={() => {}} />)
  expect(box().value).toBe("111111-222222\n333333-444444")

  fireEvent.click(screen.getByRole("button", { name: "Remove" }))

  expect(proxycheckKeys()).toEqual([])
  expect(box().value).toBe("")
})
