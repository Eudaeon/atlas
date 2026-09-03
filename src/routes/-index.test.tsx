/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ComponentType } from "react"
import { beforeAll, expect, test, vi } from "vitest"

import { Route } from "./index"

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({
    count,
    horizontal,
  }: {
    count: number
    horizontal?: boolean
  }) => {
    // Columns are not what this test is about, so all of them stay mounted.
    if (horizontal)
      return {
        getVirtualItems: () =>
          Array.from({ length: count }, (_, index) => ({
            key: index,
            index,
            size: 200,
            start: index * 200,
            end: (index + 1) * 200,
          })),
        getTotalSize: () => count * 200,
        measureElement: vi.fn(),
      }
    // One row is enough to see how many the route asked for.
    return {
      getVirtualItems: () =>
        count === 0
          ? []
          : [
              {
                key: count - 1,
                index: count - 1,
                start: (count - 1) * 33,
                end: count * 33,
              },
            ],
      getTotalSize: () => count * 33,
      measureElement: vi.fn(),
    }
  },
}))

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  Object.defineProperties(HTMLElement.prototype, {
    // Far enough from the end that paging never fires. usePagedRows owns that,
    // and its own test drives it.
    clientHeight: { configurable: true, get: () => 660 },
    scrollHeight: { configurable: true, get: () => 1_000_000 },
    scrollTo: { configurable: true, value: () => {} },
  })
})

const records = Array.from({ length: 1_000 }, (_, index) => ({
  id: `request-${index}`,
  userDisplayName: `User ${index}`,
  createdDateTime: "2026-08-23T12:00:00Z",
  status: { errorCode: 0 },
}))

test("loads a file into the table and narrows it by search", async () => {
  const App = Route.options.component as ComponentType
  await act(async () =>
    (App as ComponentType & { preload?: () => Promise<void> }).preload?.()
  )
  const { container } = render(<App />)
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!

  fireEvent.change(input, {
    target: {
      files: [
        {
          name: "sign-ins.json",
          text: async () => JSON.stringify(records),
        },
      ],
    },
  })

  // The first page, and no more of it than that.
  await waitFor(() =>
    expect(container.querySelector('[data-index="199"]')).not.toBeNull()
  )
  expect(container.querySelector('[data-index="200"]')).toBeNull()
  expect(screen.getByText("1,000 records")).not.toBeNull()
  // Cells render their value. A column def carrying `cell: undefined` erases
  // the table's default renderer and every one of them comes out blank.
  expect(screen.getByText("User 199")).not.toBeNull()
  // Record ID is one of the columns that start hidden.
  expect(screen.queryByText("request-199")).toBeNull()

  await act(async () =>
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "name:User 999" },
    })
  )
  expect(screen.getByText("1 of 1,000")).not.toBeNull()
})
