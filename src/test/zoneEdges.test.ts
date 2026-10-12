// Края зон (21.7): что схватило нажатие (край, угол, центр), куда двигается край по концу рамки (по клеткам, зона
// не уже клетки), перенос за центр; find по зоне после правки — по новой рамке. Мышью — npm run test:sim.
import { createZone, dragZone, findZone, grabAt, removeZone, ZoneGrab } from "../world/zones"
import { describe, expect, test } from "./testing"

const [X, Y] = [1570, -1250]

function area(x1: number, y1: number, x2: number, y2: number) {
  return { left_top: { x: x1, y: y1 }, right_bottom: { x: x2, y: y2 } }
}

/** Рамка от start до end (игра отдаёт область без направления). */
function selection(start: { x: number; y: number }, end: { x: number; y: number }) {
  return area(math.min(start.x, end.x), math.min(start.y, end.y), math.max(start.x, end.x), math.max(start.y, end.y))
}

function grab(x: number, y: number): ZoneGrab | undefined {
  const found = grabAt(game.get_surface("nauvis")!, { x, y })
  return found === undefined ? undefined : { ...found, start: { x, y } }
}

const edges = (g: ZoneGrab | undefined) =>
  g === undefined ? "нет" : [g.move && "центр", g.left && "лево", g.right && "право", g.top && "верх", g.bottom && "низ"].filter((s) => s !== false).join("+")

const box = (name: string) => {
  const a = findZone(name)!.area
  return `${a.left_top.x - X},${a.left_top.y - Y},${a.right_bottom.x - X},${a.right_bottom.y - Y}`
}

describe("края зон", () => {
  test("нажатие хватает край (в полклетки), угол — два края, центр — перенос; внутри и снаружи — ничего", () => {
    createZone("края", game.get_surface("nauvis")!, area(X, Y, X + 10, Y + 6))
    expect(edges(grab(X + 10.3, Y + 3.4))).toBe("право")
    expect(edges(grab(X - 0.2, Y - 0.4))).toBe("лево+верх")
    expect(edges(grab(X + 6, Y + 5.8))).toBe("низ")
    expect(edges(grab(X + 5.2, Y + 2.9))).toBe("центр")
    expect(edges(grab(X + 2, Y + 2))).toBe("нет")
    expect(edges(grab(X + 12, Y + 3))).toBe("нет")
    removeZone("края")
  })

  test("край — туда, где отпустили (по клеткам); за противоположный не уходит; центр переносит зону", () => {
    createZone("тянуть", game.get_surface("nauvis")!, area(X, Y, X + 10, Y + 6))
    const right = grab(X + 10.2, Y + 3)!
    dragZone(right, selection(right.start, { x: X + 13.4, y: Y + 3.6 }))
    expect(box("тянуть")).toBe("0,0,13,6")
    const corner = grab(X + 13.1, Y + 6.2)!
    dragZone(corner, selection(corner.start, { x: X + 11.6, y: Y + 8.3 }))
    expect(box("тянуть")).toBe("0,0,12,8")
    const left = grab(X - 0.3, Y + 4)!
    dragZone(left, selection(left.start, { x: X + 30, y: Y + 4 }))
    expect(box("тянуть")).toBe("11,0,12,8")
    removeZone("тянуть")
    createZone("нести", game.get_surface("nauvis")!, area(X, Y, X + 10, Y + 6))
    const center = grab(X + 5, Y + 3)!
    dragZone(center, selection(center.start, { x: X + 9.4, y: Y + 0.8 }))
    expect(box("нести")).toBe("4,-2,14,4")
    expect((findZone("нести")!.box.left_top as { position?: { x: number } }).position?.x).toBe(X + 4)
    removeZone("нести")
  })
})
