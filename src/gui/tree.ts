// Дерево программ команды по папкам (имя с «/», этап 17) — для окна программ и окна выбора программы.
// Папки — первыми, как в VS Code; при поиске (часть имени без учёта регистра) найденное раскрыто.
import { mapCase, trim } from "../lang/runtime/strings"
import { ProgramRecord } from "../program/store"

export type TreeEntry = { folder: string } | { id: number }

export interface TreeRow {
  entry: TreeEntry
  /** Отступ по глубине. */
  indent: string
  /** Последняя часть имени (у папки — имя папки). */
  short: string
  program?: ProgramRecord
  /** Папка раскрыта. */
  open?: boolean
}

interface FolderNode {
  folders: Map<string, FolderNode>
  programs: ProgramRecord[]
}

export const FOLDER_COLOR = "#f3d9a6"
export const LIBRARY_COLOR = "#9fd4ff"

/** Строки дерева. collapsed — свёрнутые папки (полный путь); без него всё раскрыто. */
export function programTree(programs: ProgramRecord[], search: string, collapsed?: Record<string, boolean | undefined>): TreeRow[] {
  const filter = mapCase(trim(search), false)
  const root: FolderNode = { folders: new Map(), programs: [] }
  for (const p of programs) {
    if (filter !== "" && !mapCase(p.name, false).includes(filter)) continue
    const parts = p.name.split("/")
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      let child = node.folders.get(parts[i])
      if (child === undefined) {
        child = { folders: new Map(), programs: [] }
        node.folders.set(parts[i], child)
      }
      node = child
    }
    node.programs.push(p)
  }
  const rows: TreeRow[] = []
  const walk = (node: FolderNode, path: string, indent: string): void => {
    const names: string[] = []
    for (const [name] of node.folders) names.push(name)
    table.sort(names)
    for (const name of names) {
      const full = path === "" ? name : `${path}/${name}`
      const open = filter !== "" || collapsed?.[full] !== true
      rows.push({ entry: { folder: full }, indent, short: name, open })
      if (open) walk(node.folders.get(name)!, full, `${indent}    `)
    }
    for (const p of node.programs) rows.push({ entry: { id: p.id }, indent, short: p.name.split("/").pop()!, program: p })
  }
  walk(root, "", "")
  return rows
}

/** Строка папки в списке: ▾ / ▸ и имя цветом папок. */
export function folderItem(row: TreeRow): string {
  return `${row.indent}${row.open ? "▾" : "▸"} [color=${FOLDER_COLOR}]${row.short}[/color]`
}
