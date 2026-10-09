// Чертежи с машинами (18.7; решения — DESIGN.md, «Чертежи с машинами»). Машина — юнит, в чертёж игра её
// не кладёт: при создании чертежа (и копировании Ctrl+C) машины в рамке добавляются в него размещателями своей
// модели с тегом — имя программы команды и параметры (JSON). Построенный по чертежу размещатель (рукой,
// строительным роботом, скриптом) становится машиной с новым именем; программа назначается и запускается сразу,
// а если такой программы у команды нет — машина без программы и сообщение команде.
import { BlueprintEntity, BoundingBox, LuaEntity, LuaForce, LuaItemStack, LuaPlayer, LuaRecord, LuaSurface, Tags } from "factorio:runtime"
import { onEvent } from "../events"
import { lib } from "../lang/runtime/library"
import { modelOf } from "../names"
import { assignProgram, machineOf } from "../program/machines"
import { findProgram } from "../program/store"
import { RobotRecord } from "./registry"

/** Тег записи чертежа: имя программы и параметры (JSON — в тегах чертежа нет массивов программ). */
export const BLUEPRINT_TAG = "automaton"
export interface MachineBlueprintTag {
  program?: string
  args?: string
}

function inside(area: BoundingBox, x: number, y: number): boolean {
  return x >= area.left_top.x && x <= area.right_bottom.x && y >= area.left_top.y && y <= area.right_bottom.y
}

/**
 * Машины в рамке → записи чертежа (размещатели с тегами). Координаты чертежа — по сопоставлению любой его
 * записи со зданием в мире (mapping); в чертеже одни машины — от их общего центра.
 */
export function machinesForBlueprint(surface: LuaSurface, area: BoundingBox, force: LuaForce, existing: BlueprintEntity[], mapping: Record<number, LuaEntity>): BlueprintEntity[] {
  const robots: RobotRecord[] = []
  for (const [, robot] of pairs(storage.robots.byId)) {
    if (robot === undefined || !robot.entity.valid || robot.entity.surface !== surface || robot.entity.force !== force) continue
    if (machineOf(robot.id).parked || !inside(area, robot.entity.position.x, robot.entity.position.y)) continue
    robots.push(robot)
  }
  if (robots.length === 0) return []
  table.sort(robots, (a, b) => a.id < b.id)
  let offset: { x: number; y: number } | undefined
  let last = 0
  for (const e of existing) {
    last = math.max(last, e.entity_number)
    const world = mapping[e.entity_number]
    if (offset === undefined && world !== undefined && world.valid) offset = { x: e.position.x - world.position.x, y: e.position.y - world.position.y }
  }
  if (offset === undefined) {
    let [sx, sy] = [0, 0]
    for (const r of robots) {
      sx += r.entity.position.x
      sy += r.entity.position.y
    }
    offset = { x: -math.floor(sx / robots.length), y: -math.floor(sy / robots.length) }
  }
  return robots.map((robot) => {
    const record = machineOf(robot.id)
    const program = record.programId === undefined ? undefined : storage.programs.byId[record.programId]
    const [ok, args] = record.args === undefined ? [false, undefined] : pcall(() => lib.JSON.stringify(record.args, undefined, undefined))
    const tag: MachineBlueprintTag = { program: program?.name, args: ok ? (args as string) : undefined }
    return {
      entity_number: ++last,
      name: modelOf(robot.entity.name)!.placer,
      position: { x: robot.entity.position.x + offset!.x, y: robot.entity.position.y + offset!.y },
      tags: { [BLUEPRINT_TAG]: tag as unknown as Tags[string] },
    }
  })
}

/** Чертёж, который игрок сейчас создаёт: запись библиотеки, предмет чертежа, создаваемый или в руке. */
export function blueprintOf(player: LuaPlayer, stack?: LuaItemStack, record?: LuaRecord): LuaItemStack | LuaRecord | undefined {
  if (record !== undefined && record.valid) return record
  for (const candidate of [stack, player.blueprint_to_setup, player.cursor_stack]) {
    if (candidate !== undefined && candidate.valid_for_read && candidate.is_blueprint) return candidate
  }
  return undefined
}

/** Машина, построенная по чертежу: программа по имени и параметры из тега; запускается сразу. */
export function applyBlueprintTag(robot: RobotRecord, tags: Tags | undefined): void {
  const tag = tags?.[BLUEPRINT_TAG] as MachineBlueprintTag | undefined
  if (tag === undefined) return
  const record = machineOf(robot.id)
  if (tag.args !== undefined) {
    const [ok, value] = pcall(lib.JSON.parse, tag.args)
    if (ok) record.args = value
  }
  if (tag.program === undefined) return
  const program = findProgram(tag.program, robot.entity.force.name)
  if (program === undefined || program.library) {
    robot.entity.force.print(["automaton-gui.blueprint-no-program", robot.name, tag.program])
    return
  }
  assignProgram(robot, program)
}

export function registerBlueprints(): void {
  onEvent(defines.events.on_player_setup_blueprint, (e) => {
    const player = game.get_player(e.player_index)
    if (player === undefined) return
    const blueprint = blueprintOf(player, e.stack, e.record)
    if (blueprint === undefined) return
    const existing = blueprint.get_blueprint_entities() ?? []
    const added = machinesForBlueprint(e.surface, e.area, player.force as LuaForce, existing, e.mapping.get())
    if (added.length > 0) blueprint.set_blueprint_entities([...existing, ...added])
  })
}
