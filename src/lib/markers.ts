/** The pies the map draws at each place. A marker is one SVG per point, sliced
by user, so a point says who was there and in what proportion without being
clicked. Clusters are drawn as donuts with the number of places in the hole. */

/** One user's share of a marker. */
export type Slice = { color: string; share: number }

/** One slice as an SVG path, between two turns of the circle. `hole` is zero
for a full pie and a radius for a donut. Angles start at twelve o'clock. */
const wedge = (
  from: number,
  to: number,
  r: number,
  hole: number,
  color: string
) => {
  // A whole turn would put both ends of the arc in the same place, which draws
  // nothing. Stopping a hair short leaves a seam no one can see.
  if (to - from === 1) to -= 0.0001
  const a = 2 * Math.PI * (from - 0.25)
  const b = 2 * Math.PI * (to - 0.25)
  const [ax, ay] = [Math.cos(a), Math.sin(a)]
  const [bx, by] = [Math.cos(b), Math.sin(b)]
  const long = to - from > 0.5 ? 1 : 0
  return `<path d="M ${r + hole * ax} ${r + hole * ay} L ${r + r * ax} ${r + r * ay} A ${r} ${r} 0 ${long} 1 ${r + r * bx} ${r + r * by} L ${r + hole * bx} ${r + hole * by} A ${hole} ${hole} 0 ${long} 0 ${r + hole * ax} ${r + hole * ay}" fill="${color}" />`
}

/** How big a marker is drawn, by how many connections it stands for. Steps
rather than a curve: four sizes are enough to rank a map at a glance. */
export const markerRadius = (total: number) =>
  total >= 1000 ? 22 : total >= 100 ? 18 : total >= 10 ? 14 : 11

/** `1.2k` past a thousand, so a label stays inside its donut. */
export const abbreviate = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 9950 ? 0 : 1)}k` : String(n)

/** The marker for one place, or for a cluster when given a label. Shares are
taken as weights, so they need not add up to anything in particular. */
export function pieElement(
  slices: Array<Slice>,
  total: number,
  label?: string
): HTMLElement {
  // A cluster stands for several places, so it is drawn a size up.
  const r = markerRadius(total) + (label === undefined ? 0 : 5)
  const hole = label === undefined ? 0 : r * 0.58
  const sum = slices.reduce((all, one) => all + one.share, 0)

  let at = 0
  const shape =
    slices.length === 1 && hole === 0
      ? `<circle cx="${r}" cy="${r}" r="${r}" fill="${slices[0].color}" />`
      : slices
          .map((one) => {
            const from = at
            at += sum === 0 ? 1 / slices.length : one.share / sum
            return wedge(from, at, r, hole, one.color)
          })
          .join("")

  // The hole is filled rather than cut out, so the count reads against the
  // popover colour instead of whatever the map has under it.
  const hub =
    hole === 0
      ? ""
      : `<circle cx="${r}" cy="${r}" r="${hole}" fill="var(--popover)" />` +
        `<text x="${r}" y="${r}" text-anchor="middle" dominant-baseline="central" style="font:600 ${r >= 18 ? 12 : 10}px inherit;fill:var(--popover-foreground)"></text>`

  const holder = document.createElement("div")
  holder.innerHTML = `<svg width="${r * 2}" height="${r * 2}" viewBox="0 0 ${r * 2} ${r * 2}" style="display:block;cursor:pointer;font-family:inherit;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">${shape}${hub}</svg>`
  const svg = holder.firstElementChild as HTMLElement
  // Everything above is generated here, numbers and `hsl()` strings, so it is
  // safe to concatenate. The label is the one part that comes from outside, so
  // it goes in as a text node: the day a marker is labelled with a display name
  // instead of a count, that would be markup arriving through `innerHTML`.
  if (label !== undefined) {
    const caption = svg.querySelector("text")
    if (caption !== null) caption.textContent = label
  }
  return svg
}
