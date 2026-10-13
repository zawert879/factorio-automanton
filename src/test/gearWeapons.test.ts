// Сменное оружие (22.2): me.weapon.equip / unequip из груза (неподходящие патроны — в груз), дробовик убивает
// кусаку дробью; слот оружия в окне машины (функции руки); без «Снаряжения автоматонов» — not-researched;
// погибшая машина роняет поставленное оружие.
import { LuaItemStack, LuaSurface } from "factorio:runtime"
import { setWeapon } from "../automaton/gear"
import { findRobot, RobotRecord } from "../automaton/registry"
import { gearOf } from "../automaton/variants"
import { weaponFromHand } from "../gui/machine"
import { MODELS, TECH } from "../names"
import { describeDiagnostics } from "../program/commands"
import { assignProgram, MachineRecord } from "../program/machines"
import { publishProgram } from "../program/store"
import { describe, expect, test, waitUntil } from "./testing"

const COMBAT = MODELS.find((m) => m.id === "combat-mk1")!

function site(x0: number, y0: number): LuaSurface {
  const surface = game.get_surface("nauvis")!
  surface.request_to_generate_chunks({ x: x0 + 15, y: y0 + 15 }, 2)
  surface.force_generate_chunk_requests()
  for (const e of surface.find_entities_filtered({ area: [[x0 - 12, y0 - 12], [x0 + 30, y0 + 30]] })) if (e.type !== "character") e.destroy()
  const tiles = []
  for (let x = x0 - 12; x < x0 + 30; x++) for (let y = y0 - 12; y < y0 + 30; y++) tiles.push({ name: "grass-1", position: { x, y } })
  surface.set_tiles(tiles, true, true, true)
  return surface
}

function placeCombat(surface: LuaSurface, x: number, y: number): RobotRecord {
  surface.create_entity({ name: COMBAT.placer, position: { x, y }, force: "player", raise_built: true })
  const robot = findRobot(surface.find_entities_filtered({ name: COMBAT.entity, position: { x, y }, radius: 0.5 })[0])!
  robot.fuel.insert({ name: "coal", count: 20 })
  return robot
}

function run(robot: RobotRecord, name: string, source: string): MachineRecord {
  const result = publishProgram(name, source)
  if (!result.ok) error(`не компилируется: ${describeDiagnostics(result.diagnostics).join("; ")}`)
  return assignProgram(robot, result.program)
}

const output = (record: MachineRecord) => record.console.filter((line) => !line.startsWith("—")).join("|")
const finished = (record: MachineRecord) => () => record.machine.status === "done" || record.machine.status === "error"

function hand(name?: string): LuaItemStack {
  const stack = game.create_inventory(1)[0]
  if (name !== undefined) stack.set_stack({ name, count: 1 })
  return stack
}

describe("сменное оружие", () => {
  test("equip дробовика: тип, дальность, магазины — в груз; дробью убивает кусаку; unequip — встроенное и дробь в груз", (t) => {
    const [x0, y0] = [1650, -1250]
    const surface = site(x0, y0)
    const robot = placeCombat(surface, x0 + 2.5, y0 + 2.5)
    robot.cargo.insert({ name: "shotgun", count: 1 })
    robot.cargo.insert({ name: "shotgun-shell", count: 20 })
    robot.weapon!.insert({ name: "firearm-magazine", count: 10 })
    const sensors = game.forces.player.technologies[TECH.sensors2]
    sensors.researched = true
    const biter = surface.create_entity({ name: "small-biter", position: { x: x0 + 12.5, y: y0 + 2.5 }, force: "enemy" })!
    biter.commandable!.set_command({ type: defines.command.stop, distraction: defines.distraction.none })
    const m = run(
      robot,
      "test-gear-shotgun",
      `const w = me.weapon!
print(w.item, w.type, w.range)
w.equip("shotgun")
print(w.item, w.type, w.range, me.cargo.count("shotgun"), me.cargo.count("firearm-magazine"), w.ammo === null)
w.reload()
print(w.ammo!.name, w.attack(scan.enemies()[0]))
w.unequip()
print(w.item, w.type, me.cargo.count("shotgun"), me.cargo.count("shotgun-shell") > 15)`,
    )
    waitUntil(t, "конца программы", finished(m), 1200, () => {
      sensors.researched = false
      expect(output(m)).toBe("undefined gun 15|shotgun shotgun 15 0 10 true|shotgun-shell true|undefined gun 1 true")
      expect(robot.entity.name).toBe(COMBAT.entity)
      robot.entity.destroy()
    })
  })

  test("слот оружия в окне: поставить из руки, снять пустой рукой, не оружие — сообщение; без исследования — нельзя", () => {
    const [x0, y0] = [1690, -1250]
    const surface = site(x0, y0)
    const robot = placeCombat(surface, x0 + 2.5, y0 + 2.5)
    const given: string[] = []
    const give = (stack: { name: string; count: number }) => given.push(`${stack.name}:${stack.count}`)
    const force = game.forces.player
    const rockets = hand("rocket-launcher")
    expect(weaponFromHand(rockets, robot, give, force)).toBe(undefined)
    expect(rockets.valid_for_read).toBe(false)
    expect(gearOf(robot).weapon).toBe("rocket-launcher")
    expect(robot.gun?.valid && robot.gun.sprite).toBe("item/rocket-launcher")
    expect((weaponFromHand(hand("iron-plate"), robot, give, force) as string[])[0]).toBe("automaton-gui.not-weapon")
    expect(weaponFromHand(hand(), robot, give, force)).toBe(undefined)
    expect(gearOf(robot).weapon).toBe(undefined)
    expect(given.join(",")).toBe("rocket-launcher:1")
    const tech = force.technologies[TECH.gear]
    tech.researched = false
    expect((weaponFromHand(hand("pistol"), robot, give, force) as string[])[0]).toBe("automaton-gui.needs-gear")
    tech.researched = true
    robot.entity.destroy()
  })

  test("без «Снаряжения автоматонов» equip — not-researched; погибшая машина роняет поставленное оружие", (t) => {
    const [x0, y0] = [1730, -1250]
    const surface = site(x0, y0)
    const robot = placeCombat(surface, x0 + 2.5, y0 + 2.5)
    robot.cargo.insert({ name: "pistol", count: 1 })
    const tech = game.forces.player.technologies[TECH.gear]
    tech.researched = false
    const m = run(robot, "test-gear-research", `try { me.weapon!.equip("pistol") } catch (e) { print(e instanceof ActionError ? e.code : String(e)) }`)
    waitUntil(t, "конца программы", finished(m), 300, () => {
      tech.researched = true
      expect(output(m)).toBe("not-researched")
      setWeapon(robot, "submachine-gun", () => undefined)
      const position = robot.entity.position
      robot.entity.die()
      const dropped = surface.find_entities_filtered({ name: "item-on-ground", position, radius: 3 }).map((e) => e.stack.name)
      expect(dropped.includes("submachine-gun")).toBe(true)
    })
  })
})
