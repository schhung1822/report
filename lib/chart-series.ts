/** Axis and shape helpers for the chart kit. Pure functions only. */

/** A "nice" step (1, 2, 2.5, 5 or 10 times a power of ten) at least as large as `raw`. */
function niceStep(raw: number) {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1
  const power = 10 ** Math.floor(Math.log10(raw))
  const unit = raw / power
  const step = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10
  return step * power
}

const clean = (n: number) => Math.round(n * 1e6) / 1e6

/**
 * `count` round axis values, lowest first, that cover `min`..`max`: the first is at or below `min`, the last at or above
 * `max`, evenly spaced by a round step.
 */
export function niceTicks(min: number, max: number, count: number): number[] {
  const n = Math.max(2, Math.floor(count))
  const low = Math.min(min, max)
  const high = Math.max(min, max)
  let step = niceStep((high - low) / (n - 1) || 1)
  // the step grows until the n ticks reach the top
  for (let guard = 0; guard < 8; guard += 1) {
    const start = Math.floor(low / step + 1e-9) * step
    if (start + step * (n - 1) >= high - step * 1e-9) return Array.from({ length: n }, (_, i) => clean(start + step * i))
    step = niceStep(step * 1.01)
  }
  const start = Math.floor(low / step) * step
  return Array.from({ length: n }, (_, i) => clean(start + step * i))
}

/** `count` round values from zero up to at least `max` (the y-axis of a bar chart). */
export function barTicks(max: number, count: number): number[] {
  return niceTicks(0, max > 0 ? max : 1, count)
}

/**
 * SVG props (`{...fittedDash(width, 5, 5)}`) that dash a line of `length` px so it ends on a dash instead of a gap: the
 * gap is stretched a little so whole `dash gap` pairs fill the length.
 */
export function fittedDash(length: number, dash: number, gap: number): { strokeDasharray: string } {
  if (!(length > 0)) return { strokeDasharray: `${dash} ${gap}` }
  const pairs = Math.max(1, Math.round((length + gap) / (dash + gap)))
  if (pairs === 1) return { strokeDasharray: `${dash} ${gap}` }
  const fittedGap = (length - pairs * dash) / (pairs - 1)
  return { strokeDasharray: `${dash} ${fittedGap > 0 ? clean(fittedGap) : gap}` }
}

/** A small deterministic random generator (mulberry32): the same seed always gives the same sequence in [0, 1). */
export function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Sparkle = { x: number; y: number; rx: number; ry: number }
const r = (n: number) => Math.round(n * 1000) / 1000

/** A four-pointed concave star centred on (x, y), `rx` wide and `ry` tall from the centre. */
export function starPath({ x, y, rx, ry }: Sparkle) {
  return `M ${r(x)} ${r(y - ry)} Q ${r(x)} ${r(y)} ${r(x + rx)} ${r(y)} Q ${r(x)} ${r(y)} ${r(x)} ${r(y + ry)} Q ${r(x)} ${r(y)} ${r(x - rx)} ${r(y)} Q ${r(x)} ${r(y)} ${r(x)} ${r(y - ry)} Z`
}

/** An upward triangle centred on (x, y), `rx` wide and `ry` tall from the centre. */
export function trianglePath({ x, y, rx, ry }: Sparkle) {
  return `M ${r(x)} ${r(y - ry)} L ${r(x + rx)} ${r(y + ry)} L ${r(x - rx)} ${r(y + ry)} Z`
}
