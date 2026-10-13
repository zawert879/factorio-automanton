// Края зон (21.7): что схватило нажатие (край, угол, центр), куда двигается край по концу рамки (по клеткам, зона
// не уже клетки), перенос за центр; find по зоне после правки — по новой рамке. Клик по зоне (21.8): какая зона
// открывается, переименование (занятое имя не принимается). Мышью — npm run test:sim.
import { clickedZone, createZone, dragZone, findZone, grabAt, removeZone, renameZone, ZoneGrab } from "../world/zones"
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

describe("клик по зоне", () => {
  test("клик внутри — зона (из вложенных — меньшая), по центральной ручке — тоже; рамка и клик у края — нет", () => {
    const surface = game.get_surface("nauvis")!
    createZone("большая", surface, area(X, Y, X + 10, Y + 6))
    createZone("малая", surface, area(X + 1, Y + 1, X + 3, Y + 3))
    const point = (x: number, y: number) => area(x, y, x, y)
    expect(clickedZone(surface, point(X + 7.3, Y + 4.2), undefined)).toBe("большая")
    expect(clickedZone(surface, point(X + 2.1, Y + 1.6), undefined)).toBe("малая")
    expect(clickedZone(surface, point(X + 12, Y + 2), undefined)).toBe(undefined)
    expect(clickedZone(surface, area(X + 6, Y + 2, X + 8.5, Y + 4), undefined)).toBe(undefined)
    const center = grab(X + 5.1, Y + 2.9)!
    expect(clickedZone(surface, selection(center.start, { x: X + 5.3, y: Y + 3.1 }), center)).toBe("большая")
    expect(clickedZone(surface, selection(center.start, { x: X + 8, y: Y + 3 }), center)).toBe(undefined)
    const edge = grab(X + 10.2, Y + 3)!
    expect(clickedZone(surface, selection(edge.start, edge.start), edge)).toBe(undefined)
    removeZone("большая")
    removeZone("малая")
  })

  test("переименование: зона та же под новым именем, старого нет; имя другой зоны не принимается", () => {
    const surface = game.get_surface("nauvis")!
    createZone("имя-печи", surface, area(X, Y, X + 4, Y + 4))
    createZone("имя-склад", surface, area(X + 6, Y, X + 8, Y + 2))
    expect(renameZone("имя-печи", "имя-плавильня")).toBe(true)
    expect(findZone("имя-печи")).toBe(undefined)
    expect(box("имя-плавильня")).toBe("0,0,4,4")
    expect(findZone("имя-плавильня")!.label.text).toBe("имя-плавильня")
    expect(renameZone("имя-плавильня", "имя-склад")).toBe(false)
    expect(box("имя-плавильня")).toBe("0,0,4,4")
    expect(box("имя-склад")).toBe("6,0,8,2")
    removeZone("имя-плавильня")
    removeZone("имя-склад")
  })
})
