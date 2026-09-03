/** Where an address that fell outside the map points from: a spot on the edge
of the view and the angle to turn an arrow through. Screen pixels, so this is
the projection already done and nothing else. */
export type Edge = { x: number; y: number; angle: number }

/** How far in from each side of the map the arrows are allowed. The sides are
separate because the app's own toolbar sits over the top of the map, and an
arrow under it is an arrow nobody sees. */
export type Inset = { top: number; right: number; bottom: number; left: number }

/** Somewhere on the screen. */
export type Spot = { x: number; y: number }

/** How big the map is drawn, in the same pixels. */
export type Frame = { width: number; height: number }

/** The point pulled back into the box the arrows live in, on the line from the
middle of that box out to it. Nothing comes back while the point is on screen,
because then there is nothing to point at: what the panels cover is still on
screen, and an arrow for it would be pointing at a marker right behind it. */
export function edgeSpot(
  at: Spot,
  frame: Frame,
  inset: Inset
): Edge | undefined {
  if (at.x >= 0 && at.x <= frame.width && at.y >= 0 && at.y <= frame.height) {
    return undefined
  }
  const left = Math.min(inset.left, frame.width / 2)
  const right = Math.max(frame.width - inset.right, frame.width / 2)
  const top = Math.min(inset.top, frame.height / 2)
  const bottom = Math.max(frame.height - inset.bottom, frame.height / 2)
  const middleX = (left + right) / 2
  const middleY = (top + bottom) / 2
  const dx = at.x - middleX
  const dy = at.y - middleY
  // A map with no size projects everything onto its own middle, and the middle
  // has no direction to send an arrow in.
  if (dx === 0 && dy === 0) return undefined
  // How far along that line the box runs out, whichever side it runs out on.
  const room = Math.min(
    dx === 0
      ? Infinity
      : (dx < 0 ? middleX - left : right - middleX) / Math.abs(dx),
    dy === 0
      ? Infinity
      : (dy < 0 ? middleY - top : bottom - middleY) / Math.abs(dy)
  )
  return {
    x: middleX + dx * room,
    y: middleY + dy * room,
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
  }
}

/** An arrow as drawn: where it sits, which address it goes to, and how many
connections it stands for once the ones beside it are counted in. */
export type Arrow<T> = Edge & { of: T; count: number; over: number }

/** One arrow per stretch of edge. Two addresses in the same direction sit on
top of each other, and cutting the list short instead is what made an arrow
vanish when the map moved and something busier took its place. The busiest of a
stretch is the one drawn, carrying the rest of the stretch's count. */
export function clump<T>(
  found: Array<Omit<Arrow<T>, "over">>,
  room: number
): Array<Arrow<T>> {
  const kept: Array<Arrow<T>> = []
  for (const one of [...found].sort((a, b) => b.count - a.count)) {
    const near = kept.find(
      (other) => Math.hypot(other.x - one.x, other.y - one.y) < room
    )
    if (near === undefined) kept.push({ ...one, over: 1 })
    else {
      near.count += one.count
      near.over += 1
    }
  }
  return kept
}

/** Enough of a DOM rect to know what an arrow would land behind. */
export type Box = { top: number; bottom: number; left: number; right: number }

// Strictly inside, so a spot that was just moved to the far side of one box
// counts as out of it and the next box gets its turn.
const within = (at: Spot, box: Box, room: number) =>
  at.x > box.left - room &&
  at.x < box.right + room &&
  at.y > box.top - room &&
  at.y < box.bottom + room

/** Whether something the app draws over the map is sitting on this spot. A
marker under a panel is as good as one off the map: it is there, and nothing on
screen says so. */
export const covered = (at: Spot, over: Array<Box>, room: number) =>
  over.some((box) => within(at, box, room))

/** The shortest way out of one box that still lands somewhere arrows are
allowed. Nothing when the box runs right across that area. */
function wayOut(
  at: Spot,
  box: Box,
  allowed: Box,
  room: number
): Spot | undefined {
  const ways: Array<Spot> = [
    { x: at.x, y: box.top - room },
    { x: at.x, y: box.bottom + room },
    { x: box.left - room, y: at.y },
    { x: box.right + room, y: at.y },
  ]
  let best: Spot | undefined
  let shortest = Infinity
  for (const way of ways) {
    if (way.x < allowed.left || way.x > allowed.right) continue
    if (way.y < allowed.top || way.y > allowed.bottom) continue
    const far = Math.hypot(way.x - at.x, way.y - at.y)
    if (far >= shortest) continue
    shortest = far
    best = way
  }
  return best
}

/** A spot moved off whatever covers it. Coming out from under one thing can
land on the next, so it goes round until it is in the clear or has run out of
things to be under. */
export function clearOf(
  at: Spot,
  over: Array<Box>,
  allowed: Box,
  room: number
): Spot {
  let spot = at
  for (let pass = 0; pass <= over.length; pass++) {
    const on = over.find((box) => within(spot, box, room))
    if (on === undefined) return spot
    const out = wayOut(spot, on, allowed, room)
    // Cornered: nothing to do but leave it where it is.
    if (out === undefined) return spot
    spot = out
  }
  return spot
}

/** Which way an arrow at one spot has to turn to point at another. */
export const angleTo = (from: Spot, to: Spot) =>
  (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI

/** Every arrow one view of the map calls for: one for each address it cuts
off, and one for each it draws a panel over. `project` is where a point lands
in screen pixels, which is the map's own job and the only part of this that is
not arithmetic.

An address that is on screen and in the clear gets nothing, because the marker
is already there to be seen.
*/
export function arrowsFor<T extends { count: number }>(
  points: Array<T>,
  project: (of: T) => Spot,
  frame: Frame,
  over: Array<Box>,
  { inset, gap, room }: { inset: Inset; gap: number; room: number }
): Array<Arrow<T>> {
  const allowed = {
    top: inset.top,
    left: inset.left,
    right: frame.width - inset.right,
    bottom: frame.height - inset.bottom,
  }
  const found: Array<Omit<Arrow<T>, "over">> = []
  for (const point of points) {
    const at = project(point)
    const spot = edgeSpot(at, frame, inset)
    if (spot !== undefined) {
      // Off the map: the arrow keeps the direction it came out at, moved aside
      // if the edge it landed on is taken.
      const out = clearOf(spot, over, allowed, gap)
      found.push({ ...out, angle: spot.angle, of: point, count: point.count })
      continue
    }
    if (!covered(at, over, 0)) continue
    // On the map but behind something: the arrow sits beside whatever hides it
    // and points back at it.
    const out = clearOf(at, over, allowed, gap)
    found.push({
      ...out,
      angle: angleTo(out, at),
      of: point,
      count: point.count,
    })
  }
  return clump(found, room)
}
