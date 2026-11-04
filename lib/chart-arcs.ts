/** Ring geometry for the donut charts. Angles are in radians, clockwise from 12 o'clock. */

const TAU = Math.PI * 2
const fixed = (n: number) => Math.round(n * 1000) / 1000

type Options = {
  /** The ring's centre (x and y). */
  center?: number
  /** Corner radius, measured along each edge from the corner; 0 for sharp corners. */
  corner?: number
}

/**
 * The outline of a ring segment between radii `inner` and `outer` and angles `a0`..`a1`, with its four corners rounded.
 * A segment of a whole turn or more is a full ring (two circles, filled with the even-odd rule).
 */
export function sectorPath(inner: number, outer: number, a0: number, a1: number, { center = 0, corner = 0 }: Options = {}) {
  if (!(a1 > a0) || !(outer > inner) || outer <= 0) return ""
  const point = (radius: number, angle: number): [number, number] => [center + radius * Math.sin(angle), center - radius * Math.cos(angle)]
  const at = (radius: number, angle: number) => {
    const [x, y] = point(radius, angle)
    return `${fixed(x)} ${fixed(y)}`
  }

  if (a1 - a0 >= TAU - 1e-9) {
    const circle = (radius: number, sweep: 0 | 1) => {
      const top = point(radius, 0)
      const bottom = point(radius, Math.PI)
      return `M ${fixed(top[0])} ${fixed(top[1])} A ${radius} ${radius} 0 1 ${sweep} ${fixed(bottom[0])} ${fixed(bottom[1])} A ${radius} ${radius} 0 1 ${sweep} ${fixed(top[0])} ${fixed(top[1])} Z`
    }
    return inner > 0 ? `${circle(outer, 1)} ${circle(inner, 0)}` : circle(outer, 1)
  }

  const sweep = a1 - a0
  // a corner can't be larger than half the band, nor than half of either arc
  const c = Math.max(0, Math.min(corner, (outer - inner) / 2, (outer * sweep) / 2.01, inner > 0 ? (inner * sweep) / 2.01 : Infinity))
  const large = sweep > Math.PI ? 1 : 0

  if (c <= 0.001) {
    const origin = inner <= 0
    return origin
      ? `M ${at(0, 0)} L ${at(outer, a0)} A ${outer} ${outer} 0 ${large} 1 ${at(outer, a1)} Z`
      : `M ${at(outer, a0)} A ${outer} ${outer} 0 ${large} 1 ${at(outer, a1)} L ${at(inner, a1)} A ${inner} ${inner} 0 ${large} 0 ${at(inner, a0)} Z`
  }

  const outerCut = c / outer
  const innerCut = inner > 0 ? c / inner : 0
  const largeOuter = sweep - 2 * outerCut > Math.PI ? 1 : 0
  const largeInner = sweep - 2 * innerCut > Math.PI ? 1 : 0
  return [
    `M ${at(outer, a0 + outerCut)}`,
    `A ${outer} ${outer} 0 ${largeOuter} 1 ${at(outer, a1 - outerCut)}`,
    `Q ${at(outer, a1)} ${at(outer - c, a1)}`,
    `L ${at(inner + c, a1)}`,
    `Q ${at(inner, a1)} ${at(inner, a1 - innerCut)}`,
    `A ${inner} ${inner} 0 ${largeInner} 0 ${at(inner, a0 + innerCut)}`,
    `Q ${at(inner, a0)} ${at(inner + c, a0)}`,
    `L ${at(outer - c, a0)}`,
    `Q ${at(outer, a0)} ${at(outer, a0 + outerCut)}`,
    "Z",
  ].join(" ")
}
