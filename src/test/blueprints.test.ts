// Чертежи с машинами (18.7): машины в рамке попадают в чертёж с программой и параметрами; построенный по
// чертежу размещатель — машина с этой программой (запущена), без программы у команды — без программы.
import { BLUEPRINT_TAG, machinesForBlueprint, MachineBlueprintTag } from "../automaton/blueprints"
import { findRobot, RobotRecord } from "../automaton/registry"
import { MODELS } from "../names"
import { assignProgram, machineOf } from "../program/machines"
import { deleteProgram, findProgram, publish } from "../program/store"
import { describe, expect, test } from "./testing"

const [X, Y] = [-700, 620]

function clear(left: number, top: number, size: number): void {
  const surface = game.get_surface("nauvis")!
  surface.request_to_generate_chunks({ x: left + size / 2, y: top + size / 2 }, 2)
  surface.force_generate_chunk_requests()
  for (const e of surface.find_entities_filtered({ area: [[left, top], [left + size, top + size]] })) if (e.type !== "character") e.destroy()
  const tiles = []
  for (let x = left; x < left + size; x++) for (let y = top; y < top + size; y++) tiles.push({ name: "grass-1", position: { x, y } })
  surface.set_tiles(tiles, true, true, true)
}

function place(x: number, y: number): RobotRecord {
  const surface = game.get_surface("nauvis")!
  const position = { x, y }
  surface.create_entity({ name: MODELS[0].placer, position, force: "player", raise_built: true })
  return findRobot(surface.find_entities_filtered({ name: MODELS[0].entity, position, radius: 0.5 })[0])!
}

function robotsIn(left: number, top: number, size: number): RobotRecord[] {
  const surface = game.get_surface("nauvis")!
  return surface.find_entities_filtered({ name: MODELS[0].entity, area: [[left, top], [left + size, top + size]] }).map((e) => findRobot(e)!)
}

describe("чертежи с машинами", () => {
  test("машины в чертеже: программа и параметры; постройка — та же программа, новое имя", () => {
    const old = findProgram("bp/work")
    if (old !== undefined) deleteProgram(old.id)
    const work = publish({ name: "bp/work", source: "while (true) wait(1)" })
    if (!work.ok) error("программа не опубликована")
    clear(X, Y, 40)
    const surface = game.get_surface("nauvis")!
    surface.create_entity({ name: "wooden-chest", position: { x: X + 5.5, y: Y + 5.5 }, force: "player" })
    const a = place(X + 3.5, Y + 3.5)
    const b = place(X + 7.5, Y + 3.5)
    machineOf(a.id).args = { ore: "iron-ore" }
    assignProgram(a, work.program)

    // Чертёж рамкой (как игрок): сундук — из игры, машины — добавлены.
    const inventory = game.create_inventory(1)
    const stack = inventory[0]
    stack.set_stack("blueprint")
    const area = { left_top: { x: X, y: Y }, right_bottom: { x: X + 10, y: Y + 10 } }
    const mapping = stack.create_blueprint({ surface, force: "player", area })
    const existing = stack.get_blueprint_entities() ?? []
    const added = machinesForBlueprint(surface, area, game.forces.player, existing, mapping)
    expect(added.length).toBe(2)
    const tags = added.map((e) => e.tags![BLUEPRINT_TAG] as MachineBlueprintTag)
    expect(tags[0].program).toBe("bp/work")
    expect(tags[0].args?.includes('"iron-ore"')).toBe(true)
    expect(tags[1].program).toBe(undefined)
    // Машины — на своих местах относительно сундука.
    const chest = existing.find((e) => e.name === "wooden-chest")!
    expect([added[0].position.x - chest.position.x, added[0].position.y - chest.position.y]).toEqual([-2, -2])
    stack.set_blueprint_entities([...existing, ...added])

    // Постройка в другом месте: призраки размещателей → машины.
    const ghosts = stack.build_blueprint({ surface, force: "player", position: { x: X + 25, y: Y + 25 }, build_mode: defines.build_mode.forced })
    for (const ghost of ghosts) ghost.revive({ raise_revive: true })
    const built = robotsIn(X + 15, Y + 15, 20)
    expect(built.length).toBe(2)
    const withProgram = built.find((r) => machineOf(r.id).programId === work.program.id)
    expect(withProgram !== undefined).toBe(true)
    expect(withProgram!.name !== a.name).toBe(true)
    expect((machineOf(withProgram!.id).args as { ore?: string }).ore).toBe("iron-ore")
    expect(machineOf(withProgram!.id).machine.status !== "done").toBe(true)
    expect(built.filter((r) => machineOf(r.id).programId === undefined).length).toBe(1)

    // Программы с таким именем у команды нет — машина без программы.
    const missing = surface.create_entity({
      name: "entity-ghost",
      inner_name: MODELS[0].placer,
      position: { x: X + 30.5, y: Y + 33.5 },
      force: "player",
      tags: { [BLUEPRINT_TAG]: { program: "нет-такой" } },
    })!
    missing.revive({ raise_revive: true })
    const lost = robotsIn(X + 29, Y + 32, 3)
    expect(lost.length === 1 && machineOf(lost[0].id).programId === undefined).toBe(true)

    inventory.destroy()
    for (const r of [a, b, ...built, ...lost]) if (r.entity.valid) r.entity.destroy({ raise_destroy: true })
    deleteProgram(findProgram("bp/work")!.id)
  })
})
