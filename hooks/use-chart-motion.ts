"use client"

import { animate, createTimeline, type JSAnimation, type Timeline } from "animejs"
import * as React from "react"

/** useLayoutEffect in the browser, useEffect on the server (no warning while rendering there). */
export const useIsomorphicLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect

// --- motion on/off -----------------------------------------------------------------------------------------------

const MEDIA = "(prefers-reduced-motion: reduce)"
let motionEnabled = true
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

/** Turns every chart animation on or off (reports switch it off while an image or PDF is being captured). */
export function setChartMotion(enabled: boolean) {
  if (motionEnabled === enabled) return
  motionEnabled = enabled
  notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const query = typeof window !== "undefined" ? window.matchMedia(MEDIA) : null
  query?.addEventListener("change", listener)
  return () => {
    listeners.delete(listener)
    query?.removeEventListener("change", listener)
  }
}

/** True when the user asked for less motion, or animations were turned off with `setChartMotion(false)`. */
export function useReducedMotion() {
  return React.useSyncExternalStore(
    subscribe,
    () => !motionEnabled || window.matchMedia(MEDIA).matches,
    () => false,
  )
}

// --- running entrances -------------------------------------------------------------------------------------------

/** Entrances that are running or waiting to start; `settleChartAnimations` ends them all in their final state. */
const entrances = new Set<() => void>()

/**
 * Jumps every chart that is still animating (or waiting for the screen) to its final state. Call it before taking a
 * picture of a report so the picture never shows a half-drawn chart.
 */
export function settleChartAnimations() {
  Array.from(entrances).forEach((settle) => settle())
}

// Direct DOM styling lives in small functions of its own: it is the chart's own root element, not React state.
function hide(el: HTMLElement) {
  el.style.opacity = "0"
}
function reveal(el: HTMLElement) {
  el.style.removeProperty("opacity")
}

/**
 * Plays an entrance once, the first time `root` is on screen. `play` receives an anime.js timeline to add steps to and
 * returns a function that puts everything in its final state (called when the timeline ends or is interrupted).
 * Nothing plays with reduced motion: the chart is then drawn in its final state from the start.
 */
export function useChartEntrance(
  root: React.RefObject<HTMLElement | null>,
  play: (timeline: Timeline) => (() => void) | void,
) {
  const reduced = useReducedMotion()
  const playRef = React.useRef(play)
  useIsomorphicLayoutEffect(() => {
    playRef.current = play
  })

  useIsomorphicLayoutEffect(() => {
    const el = root.current
    if (!el || reduced) return

    let started = false
    let finished = false
    let timeline: Timeline | null = null
    let restore: (() => void) | void
    let observer: IntersectionObserver | null = null

    const finish = () => {
      if (finished) return
      finished = true
      observer?.disconnect()
      entrances.delete(settle)
      reveal(el)
      restore?.()
      restore = undefined
    }
    // ends the entrance wherever it is: the timeline jumps to its end, then everything is put in its final state
    function settle() {
      if (finished) return
      if (started) {
        try {
          timeline?.complete()
        } catch {
          timeline?.cancel()
        }
      }
      finish()
    }
    const start = () => {
      if (started || finished) return
      started = true
      observer?.disconnect()
      timeline = createTimeline({ onComplete: finish })
      restore = playRef.current(timeline)
      reveal(el)
    }

    entrances.add(settle)
    if (typeof IntersectionObserver === "undefined") {
      start()
    } else {
      // hidden until the entrance starts, so the final state never flashes before the animation
      hide(el)
      observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && start(), { threshold: 0.15 })
      observer.observe(el)
    }
    return () => {
      settle()
    }
  }, [reduced, root])
}

// --- numbers -----------------------------------------------------------------------------------------------------

/**
 * When `value` changes, counts the text of `ref` from the previous value to the new one. The first value is not
 * animated (the chart's entrance counts it up). `format` turns each step into text.
 */
export function useCountUp(
  ref: React.RefObject<HTMLElement | null>,
  value: number,
  format: (value: number) => string,
  { duration = 800, enabled = true }: { duration?: number; enabled?: boolean } = {},
) {
  const reduced = useReducedMotion()
  const previous = React.useRef(value)
  const formatRef = React.useRef(format)
  useIsomorphicLayoutEffect(() => {
    formatRef.current = format
  })

  useIsomorphicLayoutEffect(() => {
    const el = ref.current
    const from = previous.current
    previous.current = value
    if (!el || reduced || !enabled || from === value || !Number.isFinite(from) || !Number.isFinite(value)) return

    const state = { current: from }
    const animation: JSAnimation = animate(state, {
      current: value,
      duration,
      ease: "outExpo",
      onUpdate: () => {
        el.textContent = formatRef.current(state.current)
      },
    })
    return () => {
      animation.cancel()
      el.textContent = formatRef.current(value)
    }
  }, [value, reduced, enabled, duration, ref])
}

// --- visibility --------------------------------------------------------------------------------------------------

/** True while `ref` is on screen. */
export function useInView(ref: React.RefObject<Element | null>, threshold = 0.15) {
  // without IntersectionObserver (old browsers, some test runners) everything counts as visible
  const [inView, setInView] = React.useState(() => typeof IntersectionObserver === "undefined")
  React.useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver((entries) => setInView(entries.some((entry) => entry.isIntersecting)), { threshold })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, threshold])
  return inView
}

// --- styles ------------------------------------------------------------------------------------------------------

/**
 * An onComplete callback for anime.js that removes the inline styles an animation left on its targets, so they go back
 * to what the stylesheet says (`releaseStyles("transform", "opacity")`).
 */
export function releaseStyles(...properties: string[]) {
  return (animation: { targets?: unknown[] } | undefined) => {
    for (const target of animation?.targets ?? []) {
      const style = (target as HTMLElement | SVGElement | undefined)?.style
      if (!style) continue
      for (const property of properties) style.removeProperty(property)
    }
  }
}
