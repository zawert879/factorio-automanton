// Классы объектов игры (19.2, DESIGN.md «API объектами»): здания, машины, враги, метки, зоны.
// Экземпляры создаёт только игра (new — ошибка), программа проверяет их через instanceof. Общий список
// для компилятора (имена — встроенные классы, src/lang/builtins.ts) и рантайма (иерархия для instanceof и
// методов, src/lang/runtime/core.ts). Объявления для проверки типов и VS Code — docs/API.md.

/** Класс → родитель; родитель записан раньше наследника. */
export const HOST_CLASSES: [name: string, parent: string | undefined][] = [
  ["Machine", undefined],
  ["Robot", "Machine"],
  ["Enemy", undefined],
  ["Marker", undefined],
  ["Zone", undefined],
  ["Building", undefined],
  ["Chest", "Building"],
  ["Furnace", "Building"],
  ["Assembler", "Building"],
  ["RocketSilo", "Building"],
  ["Lab", "Building"],
  ["Boiler", "Building"],
  ["Generator", "Building"],
  ["Reactor", "Building"],
  ["StorageTank", "Building"],
  ["Pipe", "Building"],
  ["Turret", "Building"],
  ["FlameTurret", "Building"],
  ["CargoWagon", "Building"],
  ["FluidWagon", "Building"],
  ["Locomotive", "Building"],
  ["Vehicle", "Building"],
  ["ChargingStation", "Building"],
]

const PARENT: Record<string, string | undefined> = {}
const KNOWN: Record<string, boolean> = {}
for (const [name, parent] of HOST_CLASSES) {
  PARENT[name] = parent
  KNOWN[name] = true
}

/** Класс объекта игры (или его наследник): isHostSubclass("Furnace", "Building") — да. */
export function isHostSubclass(this: void, name: string, ancestor: string): boolean {
  let current: string | undefined = name
  while (current !== undefined) {
    if (current === ancestor) return true
    current = PARENT[current]
  }
  return false
}

export function isHostClass(this: void, name: string): boolean {
  return KNOWN[name] === true
}
