"use client"

import * as React from "react"

type Size = { width: number; height: number }

/**
 * The size of an element, kept up to date. Until it is measured (and on the server) `fallback` is returned.
 * Attach the returned ref to the element: `const [ref, { width }] = useChartSize<HTMLDivElement>({ width: 600, height: 300 })`.
 */
export function useChartSize<T extends HTMLElement>(fallback: Size): [React.RefObject<T | null>, Size] {
  const ref = React.useRef<T | null>(null)
  const [size, setSize] = React.useState<Size>(fallback)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const rect = el.getBoundingClientRect()
      // offset sizes ignore transforms (an element mid-scale still has its real layout size)
      const width = el.offsetWidth || rect.width
      const height = el.offsetHeight || rect.height
      setSize((current) => (Math.abs(current.width - width) < 0.01 && Math.abs(current.height - height) < 0.01 ? current : { width, height }))
    }
    read()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, size]
}
