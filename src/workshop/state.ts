// Мастерская схем (этап 15): что лежит в storage. Узел — тело и разъёмы на поверхности программы; его вид
// и значения — здесь; провода — только на поверхности (читаются при проверке и публикации).
import { LocalisedString, LuaEntity, LuaRenderObject, LuaSurface, MapPosition } from "factorio:runtime"
import { GraphValue } from "../graph/model"

export interface WorkshopNode {
  id: number
  kind: string
  values: Record<string, GraphValue | undefined>
  body: LuaEntity
  /** Разъёмы: «in:<id>» и «out:<id>» (порядок — in:exec, out:next, out:then…) → здание. */
  pins: Record<string, LuaEntity | undefined>
  /** Заголовок, подписи, рамка ошибки — пересоздаются при изменении узла. */
  renders: LuaRenderObject[]
  /** Ошибка после «Проверить» или «Опубликовать». */
  error?: LocalisedString
}

export interface Workshop {
  programId: number
  force: string
  surface: LuaSurface
  nextId: number
  nodes: Record<number, WorkshopNode | undefined>
}

/** Игрок в мастерской: куда вернуть его и персонажа. */
export interface WorkshopVisitor {
  programId: number
  character?: LuaEntity
  surface?: LuaSurface
  position?: MapPosition
  /** Узел, открытый в окне настроек. */
  editing?: number
  /** Раздел палитры. */
  category?: string
}

export interface WorkshopState {
  byProgram: Record<number, Workshop | undefined>
  /** Тело узла: unit_number → программа и номер узла. */
  bodies: Record<number, { programId: number; node: number } | undefined>
  /** Разъём: unit_number → программа, узел, ключ разъёма. */
  pins: Record<number, { programId: number; node: number; key: string } | undefined>
  visitors: Record<number, WorkshopVisitor | undefined>
  /** Разъёмы, вставленные раньше своего тела: через тик без хозяина — убираются. */
  orphans: LuaEntity[]
}

export function initWorkshop(): void {
  storage.workshop ??= { byProgram: {}, bodies: {}, pins: {}, visitors: {}, orphans: [] }
  storage.workshop.orphans ??= []
}

export function workshopState(): WorkshopState {
  initWorkshop()
  return storage.workshop!
}
