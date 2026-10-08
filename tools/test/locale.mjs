// Проверка локали (14.2): у ru и en одни и те же ключи, а каждый ключ, который код называет
// строкой (["automaton-gui.publish"]), коды ошибок компилятора и действий — есть в локали.
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/** Ключи файла; повторный ключ в разделе игра не загрузит (Duplicate key) — в duplicates. */
function parseCfg(path, duplicates = []) {
  const keys = new Set()
  let section = ""
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim()
    if (line === "" || line.startsWith(";") || line.startsWith("#")) continue
    const header = /^\[(.+)\]$/.exec(line)
    if (header) {
      section = header[1]
      continue
    }
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    const key = `${section}.${line.slice(0, eq)}`
    if (keys.has(key)) duplicates.push(`${path.split("/locale/")[1]}: ${key}`)
    keys.add(key)
  }
  return keys
}

function sources(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== "test") sources(path, out)
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".generated.ts")) out.push(path)
  }
  return out
}

export function checkLocale(root) {
  const problems = []
  const files = readdirSync(join(root, "mod", "locale", "ru")).filter((f) => f.endsWith(".cfg"))
  const ru = new Set()
  const en = new Set()
  const duplicates = []
  for (const file of files) {
    for (const k of parseCfg(join(root, "mod", "locale", "ru", file), duplicates)) ru.add(k)
    for (const k of parseCfg(join(root, "mod", "locale", "en", file), duplicates)) en.add(k)
  }
  for (const d of duplicates) problems.push(`ключ повторяется (игра не загрузит мод): ${d}`)
  for (const k of ru) if (!en.has(k)) problems.push(`нет в en: ${k}`)
  for (const k of en) if (!ru.has(k)) problems.push(`нет в ru: ${k}`)

  const code = sources(join(root, "src")).map((f) => readFileSync(f, "utf8")).join("\n")
  const used = new Set()
  // Ключи строкой: ["automaton-gui.publish", …] и "automaton.alert".
  const sections = new Set(["automaton", "automaton-gui", "automaton-diagnostic", "automaton-error", "automaton-action", "automaton-feature"])
  for (const m of code.matchAll(/["'`](automaton(?:-[a-z]+)?)\.([a-z0-9][a-zA-Z0-9_-]*)["'`]/g)) if (sections.has(m[1])) used.add(`${m[1]}.${m[2]}`)
  // Коды ошибок компилятора: report("код", …), fail("код", …), { code: "код" }, failure("код").
  // Диагностики — у компилятора (без рантайма: у его ошибок свои коды) и публикации.
  const lang = sources(join(root, "src", "lang"))
    .filter((f) => !f.includes(`${join("lang", "runtime")}`))
    .concat([join(root, "src", "program", "store.ts")])
    .map((f) => readFileSync(f, "utf8"))
    .join("\n")
  for (const m of lang.matchAll(/\b(?:report|fail|failure)\(\s*(?:[a-zA-Z.]+,\s*)?"([a-z][a-z0-9-]+)"/g)) used.add(`automaton-diagnostic.${m[1]}`)
  for (const m of lang.matchAll(/code: "([a-z][a-z0-9-]+)", params/g)) used.add(`automaton-diagnostic.${m[1]}`)
  // Неподдерживаемые возможности: unsupported ["что"].
  for (const m of lang.matchAll(/"unsupported", \["([a-z.-]+)"\]/g)) used.add(`automaton-feature.${m[1]}`)
  // Действия и ошибки действий: union-типы ActionKind и ActionError.
  const actions = readFileSync(join(root, "src", "automaton", "actions.ts"), "utf8")
  const kinds = /export type ActionKind =([^\n]+)/.exec(actions)?.[1] ?? ""
  for (const m of kinds.matchAll(/"([a-z-]+)"/g)) used.add(`automaton-action.${m[1]}`)
  const errors = /export type ActionError =([\s\S]*?)\n\n/.exec(actions)?.[1] ?? ""
  for (const m of errors.matchAll(/"([a-z-]+)"/g)) used.add(`automaton-error.${m[1]}`)
  for (const k of used) if (!ru.has(k)) problems.push(`в коде есть, в локали нет: ${k}`)
  return { keys: ru.size, used: used.size, problems }
}
