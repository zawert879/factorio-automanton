// Настройка VS Code у игрока (25.1, 25.2): система для пути, записана ли папка, ответ на предложение, когда утилита
// синхронизации последний раз стучалась в игру. Хранится в storage.vscode (vscodeState в src/program/sync.ts); пишут
// окно «VS Code» и запросы утилиты. Здесь — без API игры: проверяется тестами вне игры.
import { FolderOs } from "./folderPath"

export interface VsCodeState {
  os?: FolderOs
  /** Тик, когда игрок записал папку этой карты. */
  written?: number
  /** Ответил на предложение в окне программ («Настроить» или «Не сейчас»). */
  offered?: boolean
  /** Тик последнего запроса утилиты от этого игрока (утилита в режиме слежения шлёт ping раз в 10 с). */
  contact?: number
  /** Карта папки, из которой пришёл запрос (.automaton-map.json). */
  contactMap?: string
}

/** Связь с утилитой: на связи, на связи из папки другой карты, была и пропала, ждём, молчит минуту, папки нет. */
export type LinkStatus = "connected" | "wrong-map" | "lost" | "waiting" | "silent" | "none"

/** Утилита на связи, если стучалась не позже 30 с назад (ping — раз в 10 с). */
export const CONTACT_TICKS = 30 * 60
/** Папку записали, а утилита молчит минуту — подсказать, что проверить. */
export const SILENT_TICKS = 60 * 60

export function linkStatus(state: VsCodeState, tick: number, map: string): LinkStatus {
  if (state.contact !== undefined && tick - state.contact < CONTACT_TICKS) {
    return state.contactMap !== undefined && state.contactMap !== map ? "wrong-map" : "connected"
  }
  if (state.contact !== undefined) return "lost"
  if (state.written !== undefined) return tick - state.written >= SILENT_TICKS ? "silent" : "waiting"
  return "none"
}
