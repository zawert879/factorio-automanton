// Подписи функций библиотек для узла «Вызвать» (20.1): какие экспортированные функции видит схема и с какими разъёмами.
import { describe, expect, test } from "../../src/test/testing"
import { formatParams, parseParams } from "../../src/graph/codegen"
import { libraryFunctions, signatureValues } from "../../src/graph/signatures"
import { EXAMPLE_PROGRAMS } from "../../src/program/examples.generated"

function signatures(source: string): string[] {
  return libraryFunctions(source).map((f) => {
    const values = signatureValues(f)
    return `${f.name}(${values.params}): ${values.returns}${values.nullable === true ? " | null" : ""}`
  })
}

describe("подписи функций библиотек", () => {
  test("простые типы — в разъёмы, классы зданий — с приведением, null — необязательно", () => {
    const source = [
      "export function a(n: number, s: string, f: boolean, i: Item, w: Fluid, p: Position): void {}",
      "export function b(x: Building, y: Furnace, m: Machine, r: Robot, k: Marker, z: Zone, t: Target, v: Value): Chest { return x as Chest }",
      "export function c(list: Building[], cs: Chest[], ms: Machine[], vs: Value[]): number | null { return null }",
      "export function d(min = 0.3, name?: string, e: Enemy | null = null) { return 1 }",
      "function hidden(x: number): number { return x }",
      "export { hidden as shown }",
    ].join("\n")
    expect(signatures(source)).toEqual([
      "a(n: number, s: string, f: boolean, i: item, w: fluid, p: position): none",
      "b(x: entity, y: entity as Furnace, m: robot, r: robot as Robot, k: marker, z: zone, t: target, v: value): entity",
      "c(list: entities, cs: entities as Chest[], ms: robots, vs: list): number | null",
      "d(min?: number, name?: string, e?: enemy): value",
      "shown(x: number): number",
    ])
  })

  test("функции с параметром-функцией, обобщённые, с непонятным типом — не для схем", () => {
    const source = [
      "export function attempt(action: () => number): number { return action() }",
      "export function pick<T extends Building>(kind: BuildingKind<T>): T | null { return null }",
      "export function rest(...xs: number[]): void {}",
      "export function obj(o: { x: number }): void {}",
      "export const K = 5",
    ].join("\n")
    expect(signatures(source)).toEqual([])
  })

  test("пример lib/Помощники: chestAt, nearestField, refuelFrom", () => {
    const helpers = EXAMPLE_PROGRAMS.find((e) => e.name === "lib/Помощники")!
    expect(libraryFunctions(helpers.source).map((f) => f.name)).toEqual(["chestAt", "nearestField", "refuelFrom"])
  })

  test("строка параметров: туда и обратно", () => {
    const text = "куда: marker, сколько?: number, печь: entity as Furnace, списком: entities as Chest[]"
    expect(formatParams(parseParams(text))).toBe(text)
    expect(parseParams("a, b:number").map((p) => `${p.name}:${p.type}`)).toEqual(["a:value", "b:number"])
  })
})
