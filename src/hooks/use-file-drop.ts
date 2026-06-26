import { useEffect, useRef, useState } from "react"

// Tracks a file being dragged anywhere over the window and reports a drop,
// returning whether a drag is currently in progress so the caller can show an
// overlay. Drag events fire per-element — a `dragleave` for every child the
// cursor crosses — so a depth counter distinguishes truly leaving the window
// from moving between its children. Only drags carrying files raise the overlay,
// so dragging selected text or a link does nothing.
export function useFileDrop(onDrop: (file: File) => void) {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  // Held in a ref so the listeners (attached once) always call the latest
  // callback without re-binding every time it changes.
  const onDropRef = useRef(onDrop)
  useEffect(() => {
    onDropRef.current = onDrop
  }, [onDrop])

  useEffect(() => {
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files")

    function handleEnter(event: DragEvent) {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth.current++
      setDragging(true)
    }
    // The browser only fires `drop` (rather than discarding the file and
    // navigating to it) when both dragover and drop call preventDefault.
    function handleOver(event: DragEvent) {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
    }
    function handleLeave(event: DragEvent) {
      if (!hasFiles(event)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    }
    function handleDrop(event: DragEvent) {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth.current = 0
      setDragging(false)
      const file = event.dataTransfer?.files?.[0]
      if (file) onDropRef.current(file)
    }

    window.addEventListener("dragenter", handleEnter)
    window.addEventListener("dragover", handleOver)
    window.addEventListener("dragleave", handleLeave)
    window.addEventListener("drop", handleDrop)
    return () => {
      window.removeEventListener("dragenter", handleEnter)
      window.removeEventListener("dragover", handleOver)
      window.removeEventListener("dragleave", handleLeave)
      window.removeEventListener("drop", handleDrop)
    }
  }, [])

  return dragging
}
