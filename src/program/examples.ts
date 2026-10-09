// Примеры программ (examples/*.ts). Сами в игру не попадают: игроки пишут свои программы (стартовых программ
// в библиотеке команды нет). Публикуются по требованию — демо-фабрика /am-science и тесты.
import { resolveModulePath } from "../lang/modules"
import { EXAMPLE_PROGRAMS } from "./examples.generated"
import { findProgram, publish } from "./store"

type Example = (typeof EXAMPLE_PROGRAMS)[number]

/** Пример и примеры, которые он импортирует (lib/Помощники), — библиотеки раньше. */
function withImports(name: string, out: Example[]): void {
  const example = EXAMPLE_PROGRAMS.find((e) => e.name === name)
  if (example === undefined) error(`нет примера «${name}»`)
  if (out.includes(example)) return
  for (const [spec] of string.gmatch(example.source, 'from%s*"([^"]+)"')) {
    const resolved = resolveModulePath(example.name, spec)
    if ("name" in resolved && EXAMPLE_PROGRAMS.some((e) => e.name === resolved.name)) withImports(resolved.name, out)
  }
  out.push(example)
}

/** Опубликовать команде примеры (с их библиотеками), которых у неё ещё нет; уже опубликованные не трогать. */
export function publishExamples(force: string, names: string[]): void {
  const list: Example[] = []
  for (const name of names) withImports(name, list)
  for (const example of list) {
    if (findProgram(example.name, force) !== undefined) continue
    const result = publish({ name: example.name, source: example.source, force, author: "Automaton" })
    if (!result.ok) error(`пример «${example.name}» не скомпилировался: ${serpent.line(result.diagnostics)}`)
  }
}
