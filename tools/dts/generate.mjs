// Генератор automaton.d.ts (5.5): объявления API из docs/API.md (блоки ```ts с declare / type / interface).
// Пишет mod/automaton.d.ts (для игроков, VS Code) и src/gui/dts.generated.ts (окно «Типы для VS Code»,
// папка для VS Code: типы, tsconfig, утилита синхронизации mod/tools/automaton-sync.mjs, задача VS Code).
// Программы-примеры (examples/*.ts, имя — из строки «// @program Имя») — в src/program/examples.generated.ts:
// в игру сами не попадают, их публикуют /am-science и тесты (src/program/examples.ts).
// С флагом --check проверяет tsc --strict, что примеры из API.md и руководства и программы-примеры с этими
// типами компилируются.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { isDeclarationBlock } from "./blocks.mjs"

const root = join(fileURLToPath(import.meta.url), "..", "..", "..")
const api = readFileSync(join(root, "docs", "API.md"), "utf8")
const blocks = [...api.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1])
const declarations = blocks.filter((b) => isDeclarationBlock(b))
const examples = blocks.filter((b) => !declarations.includes(b))
// Примеры из руководства игрока (и его английской версии, 18.9) — тоже программы, они должны проходить tsc.
for (const doc of ["docs/PLAYER_GUIDE.md", "README.md", "docs/en/PLAYER_GUIDE.md", "README.en.md"].map((f) => join(root, f))) {
  if (!existsSync(doc)) continue
  for (const m of readFileSync(doc, "utf8").matchAll(/```ts\n([\s\S]*?)```/g)) examples.push(m[1])
}

const headerEn = `// Automaton API types (the Automaton mod for Factorio) — for the VS Code editor.
// Easiest: in the game, the "Team programs" window → "Folder for VS Code" — the mod writes a ready folder
// (programs, this file, tsconfig.json, sync with the game). By hand:
//   1. Create a folder and put this file and tsconfig.json in it:
//      { "compilerOptions": { "strict": true, "target": "es2020", "noLib": true, "noEmit": true, "moduleDetection": "force",
//        "module": "preserve", "moduleResolution": "bundler" } }
//   2. Write the program in a .ts file next to it — VS Code suggests functions and finds errors.
//   3. Copy the program text into the "Team programs" window in the game and press "Publish".
// Language and API reference — docs/API.md and docs/LANGUAGE.md (github.com/zawert879/factorio-automanton).
`
const header = `// Типы API автоматонов (мод Automaton для Factorio) — для редактора VS Code.
// Проще всего: в игре окно «Программы команды» → «Папка для VS Code» — мод запишет готовую папку
// (программы, этот файл, tsconfig.json, синхронизацию с игрой). Вручную:
//   1. Создайте папку, положите в неё этот файл и tsconfig.json:
//      { "compilerOptions": { "strict": true, "target": "es2020", "noLib": true, "noEmit": true, "moduleDetection": "force",
//        "module": "preserve", "moduleResolution": "bundler" } }
//   2. Пишите программу в файле .ts рядом — VS Code подскажет функции и найдёт ошибки.
//   3. Скопируйте текст программы в окно «Программы команды» в игре и нажмите «Опубликовать».
// Справка по языку и API — docs/API.md и docs/LANGUAGE.md.
`
const tsconfig = JSON.stringify(
  {
    // module / moduleResolution: import "../lib/Помощники" находит соседний файл без расширения (этап 17).
    compilerOptions: {
      strict: true,
      target: "es2020",
      // Стандартная библиотека — своя, в automaton.d.ts (что есть в игре): Promise, async, setTimeout… — ошибка сразу.
      noLib: true,
      noEmit: true,
      moduleDetection: "force",
      module: "preserve",
      moduleResolution: "bundler",
      types: [],
      // Плагин VS Code (mod/tools/automaton-ts-plugin.js): ошибки на неподдерживаемом и подсказки о тиках;
      // язык подставляет игра по языку игрока.
      plugins: [{ name: "automaton-ts-plugin", lang: "ru" }],
    },
    // Программы — в src (рядом — служебные файлы); старые файлы в корне папки не мешают.
    include: ["automaton.d.ts", "src"],
  },
  null,
  2,
)
const tool = readFileSync(join(root, "mod", "tools", "automaton-sync.mjs"), "utf8")
const tsPlugin = readFileSync(join(root, "mod", "tools", "automaton-ts-plugin.js"), "utf8")
/**
 * Комментарии объявлений на одном языке (18.4). В docs/API.md английский — рядом с русским: строка « * @en …»
 * в /** … *\/ и «// русский @en english» в строчном комментарии. ru — без @en; en — английский вместо русского
 * (нет перевода — русский, а комментарий попадает в untranslated).
 */
const untranslated = []
const cyrillic = /[А-Яа-яЁё]/
function localize(text, lang) {
  const docs = text.replace(/^([ \t]*)\/\*\*([\s\S]*?)\*\//gm, (doc, indent, inner) => {
    const lines = inner.split("\n").map((l) => l.replace(/^\s*\*\s?/, "").trim()).filter(Boolean)
    const english = lines.filter((l) => l.startsWith("@en ")).map((l) => l.slice(4))
    const russian = lines.filter((l) => !l.startsWith("@en "))
    if (lang === "en" && english.length === 0 && russian.some((l) => cyrillic.test(l))) untranslated.push(russian.join(" "))
    const kept = lang === "en" && english.length > 0 ? english : russian
    if (kept.length === 1) return `${indent}/** ${kept[0]} */`
    return [`${indent}/**`, ...kept.map((l) => `${indent} * ${l}`), `${indent} */`].join("\n")
  })
  return docs.replace(/\/\/ (.*)$/gm, (line, comment) => {
    const at = comment.indexOf(" @en ")
    if (at < 0) {
      if (lang === "en" && cyrillic.test(comment)) untranslated.push(comment)
      return line
    }
    return `// ${lang === "en" ? comment.slice(at + 5) : comment.slice(0, at)}`
  })
}
/**
 * Словарь имён (24.1, tools/names/names.json — npm run names): в типах для VS Code Item, Fluid и BuildingName —
 * списки имён базовой игры (VS Code подсказывает их при наборе), с хвостом (string & {}) — имена других модов тоже
 * годятся. Проверке типов в игре — без списков (DTS_CHECK): там они только замедлили бы разбор.
 */
const namesFile = join(root, "tools", "names", "names.json")
const names = existsSync(namesFile) ? JSON.parse(readFileSync(namesFile, "utf8")) : { buildings: [], items: [], fluids: [] }
function withNames(text, lang) {
  const union = (type, list, doc) => {
    if (list.length === 0) return undefined
    const lines = list.map((n) => `  | ${JSON.stringify(n.name)} // ${n[lang]}`)
    return [`/** ${doc} */`, `type ${type} =`, ...lines, "  | (string & {});"].join("\n")
  }
  const docs = {
    ru: {
      Item: "Предмет — внутреннее имя игры. Словарь — docs/NAMES.md, в игре — справка F1, «Имена»; имена других модов тоже можно.",
      Fluid: "Жидкость — внутреннее имя игры.",
      BuildingName: "Имя здания (zone(…).find, scan.buildings). Словарь по классам — docs/NAMES.md.",
    },
    en: {
      Item: "An item — the game's internal name. The list is in docs/en/NAMES.md, in the game — help F1, Names; names from other mods work too.",
      Fluid: "A fluid — the game's internal name.",
      BuildingName: "A building name (zone(…).find, scan.buildings). The list by class is in docs/en/NAMES.md.",
    },
  }[lang]
  let result = text
  for (const [type, list] of [["Item", names.items], ["Fluid", names.fluids], ["BuildingName", names.buildings]]) {
    const replacement = union(type, list, docs[type])
    if (replacement !== undefined) result = result.replace(new RegExp(`^type ${type} = string;.*$`, "m"), replacement)
  }
  return result
}
/**
 * Стандартная библиотека для VS Code (25.3) — ровно то, что есть в игре: объявления src/lang/stdlib.ts (их же читает
 * проверка типов в игре) и минимум, без которого TypeScript не работает (Object, Function, итераторы для for…of,
 * конструкторы Map и Set, служебные типы, которые понимает игра). Вместо lib.es2020 (tsconfig: noLib): Promise, async,
 * генераторы, setTimeout, Date, console, методы, которых нет в игре, — ошибка в VS Code, как при публикации.
 */
const stdlibSource = readFileSync(join(root, "src", "lang", "stdlib.ts"), "utf8")
const stdlib = stdlibSource
  .slice(stdlibSource.indexOf("`") + 1, stdlibSource.lastIndexOf("`"))
  // undefined в TypeScript — встроенное имя, объявлять его нельзя.
  .replace(/^declare const undefined: undefined;\n/m, "")
function vscodeLib(lang) {
  const intro =
    lang === "ru"
      ? "// ---------- Стандартная библиотека: только то, что есть в игре. Promise, async, генераторов, setTimeout, Date,\n// console и прочего здесь нет — VS Code подчеркнёт их сразу, как и игра при публикации. ----------\n"
      : "// ---------- The standard library: only what the game has. There is no Promise, async, generators, setTimeout,\n// Date, console and the like — VS Code underlines them right away, as the game does on publishing. ----------\n"
  const readonlyArray = [
    "interface ReadonlyArray<T> {",
    "  readonly length: number;",
    "  readonly [index: number]: T;",
    "  [Symbol.iterator](): IterableIterator<T>;",
    "  slice(start?: number, end?: number): T[];",
    "  concat(...items: (T | readonly T[])[]): T[];",
    "  join(separator?: string): string;",
    "  indexOf(value: T, fromIndex?: number): number;",
    "  lastIndexOf(value: T, fromIndex?: number): number;",
    "  includes(value: T, fromIndex?: number): boolean;",
    "  at(index: number): T | undefined;",
    "  forEach(fn: (value: T, index: number, array: readonly T[]) => void): void;",
    "  map<U>(fn: (value: T, index: number, array: readonly T[]) => U): U[];",
    "  filter(fn: (value: T, index: number, array: readonly T[]) => unknown): T[];",
    "  find(fn: (value: T, index: number, array: readonly T[]) => unknown): T | undefined;",
    "  findIndex(fn: (value: T, index: number, array: readonly T[]) => unknown): number;",
    "  some(fn: (value: T, index: number, array: readonly T[]) => unknown): boolean;",
    "  every(fn: (value: T, index: number, array: readonly T[]) => unknown): boolean;",
    "  reduce<U>(fn: (acc: U, value: T, index: number, array: readonly T[]) => U, initial: U): U;",
    "  flatMap<U>(fn: (value: T, index: number, array: readonly T[]) => U | U[]): U[];",
    "}",
  ].join("\n")
  return `${intro}
interface Object {}
interface Function {}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments { length: number; [index: number]: any }
interface RegExp {}
interface SymbolConstructor { readonly iterator: unique symbol }
declare var Symbol: SymbolConstructor;
interface IteratorYieldResult<T> { done?: false; value: T }
interface IteratorReturnResult<T> { done: true; value: T }
type IteratorResult<T, TReturn = any> = IteratorYieldResult<T> | IteratorReturnResult<TReturn>;
interface Iterator<T, TReturn = any, TNext = any> { next(...args: [] | [TNext]): IteratorResult<T, TReturn> }
interface Iterable<T, TReturn = any, TNext = any> { [Symbol.iterator](): Iterator<T, TReturn, TNext> }
interface IterableIterator<T, TReturn = any, TNext = any> extends Iterator<T, TReturn, TNext> { [Symbol.iterator](): IterableIterator<T, TReturn, TNext> }
interface Array<T> { [Symbol.iterator](): IterableIterator<T> }
interface String { [Symbol.iterator](): IterableIterator<string> }
interface Map<K, V> { [Symbol.iterator](): IterableIterator<[K, V]> }
interface Set<T> { [Symbol.iterator](): IterableIterator<T> }
declare var Map: { new <K, V>(entries?: readonly (readonly [K, V])[] | null): Map<K, V> };
declare var Set: { new <T>(values?: readonly T[] | null): Set<T> };
${readonlyArray}
type Partial<T> = { [P in keyof T]?: T[P] };
type Required<T> = { [P in keyof T]-?: T[P] };
type Readonly<T> = { readonly [P in keyof T]: T[P] };
type Record<K extends keyof any, T> = { [P in K]: T };
type NonNullable<T> = T & {};
${stdlib}
// ---------- ${lang === "ru" ? "API автоматонов" : "The automaton API"} ----------
`
}
const plainDts = header + "\n" + localize(declarations.join("\n"), "ru")
const dts = withNames(header + "\n" + vscodeLib("ru") + localize(declarations.join("\n"), "ru"), "ru")
const dtsEn = withNames(headerEn + "\n" + vscodeLib("en") + localize(declarations.join("\n"), "en"), "en")
writeFileSync(join(root, "mod", "automaton.d.ts"), dts)
writeFileSync(join(root, "mod", "automaton.en.d.ts"), dtsEn)
// Справка в игре (18.5): разделы docs/API.md с объявлениями → записи (объявление верхнего уровня: имя, текст,
// описание) на двух языках и пример раздела (первый блок кода раздела без объявлений).
const SECTION_EN = {
  "Базовые типы": "Basic types",
  "Вывод": "Output",
  "Своя машина (me)": "Your machine (me)",
  "Движение": "Movement",
  "Предметы": "Items",
  "Здания": "Buildings",
  "Жидкости": "Fluids",
  "Энергия": "Energy",
  "Зрение": "Vision",
  "Карта": "Map",
  "Связь": "Messaging",
  "Доска и задачи": "Board and tasks",
  "Табло": "Displays",
  "Бой": "Combat",
  "Сигналы": "Signals",
  "Время и мир": "Time and world",
  "Ошибки": "Errors",
  "Модели машин": "Machine models",
  "Исследования": "Research",
}

/** Объявления верхнего уровня блока: строки до следующего declare / interface / type / комментария на глубине 0. */
function statements(block) {
  const out = []
  let cur = []
  let code = false
  let depth = 0
  let inDoc = false
  const flush = () => {
    if (cur.length > 0 && code) out.push(cur.join("\n"))
    if (code) cur = []
    code = false
  }
  for (const line of block.split("\n")) {
    const trimmed = line.trim()
    if (depth === 0 && !inDoc) {
      if (trimmed === "") {
        if (code) flush()
        continue
      }
      if (code && /^(declare |interface |type |\/\*\*|\/\/)/.test(line)) flush()
    }
    cur.push(line)
    if (inDoc || trimmed.startsWith("/**")) {
      inDoc = !trimmed.endsWith("*/")
      continue
    }
    const bare = line.replace(/\/\/.*$/, "").replace(/"[^"]*"/g, "")
    if (!trimmed.startsWith("//")) code = true
    depth += (bare.match(/[{([]/g) ?? []).length - (bare.match(/[})\]]/g) ?? []).length
  }
  flush()
  return out
}

function entryOf(statement) {
  const lines = statement.split("\n")
  const docLines = []
  while (lines.length > 0 && /^\s*(\/\*\*|\*|\/\/)/.test(lines[0])) docLines.push(lines.shift())
  const signature = lines.join("\n")
  const name = /^(?:declare (?:function|const|let|(?:abstract )?class|namespace)|interface|type) ([A-Za-z_$][\w$]*)/m.exec(signature)?.[1]
  const doc = docLines.map((l) => l.replace(/^\s*(\/\*\*|\*\/|\*|\/\/)\s?/, "").replace(/\*\/$/, "").trim()).filter(Boolean).join(" ")
  const keys = [...new Set([...signature.matchAll(/\b([A-Za-z_$][\w$]*)\s*[(:?]/g)].map((m) => m[1].toLowerCase()))].join(" ")
  return { name, signature, doc, keys }
}

const guide = readFileSync(join(root, "docs", "PLAYER_GUIDE.md"), "utf8")
const firstBlock = /## Первые 15 минут[\s\S]*?\n( *)```ts\n([\s\S]*?)\n *```/.exec(guide)
if (firstBlock === null) throw new Error("PLAYER_GUIDE.md: нет кода в «Первые 15 минут»")
const firstProgram = firstBlock[2].split("\n").map((l) => l.slice(firstBlock[1].length)).join("\n")
const help = []
{
  let section
  for (const part of api.split(/^## /m).slice(1)) {
    const title = part.split("\n")[0].replace(/`/g, "").trim()
    section = { title: [title, SECTION_EN[title] ?? title], entries: [], example: undefined }
    for (const m of part.matchAll(/```ts\n([\s\S]*?)```/g)) {
      const body = m[1]
      const isDeclaration = isDeclarationBlock(body)
      if (!isDeclaration) {
        section.example ??= body.replace(/\n$/, "")
        continue
      }
      const ru = statements(localize(body, "ru")).map(entryOf)
      const en = statements(localize(body, "en")).map(entryOf)
      ru.forEach((entry, i) => {
        if (entry.name === undefined) return
        const last = section.entries[section.entries.length - 1]
        // Перегрузки (несколько declare function с одним именем подряд) — одна запись.
        if (last !== undefined && last.name === entry.name) {
          last.signature = [`${last.signature[0]}\n${entry.signature}`, `${last.signature[1]}\n${en[i].signature}`]
          return
        }
        section.entries.push({ name: entry.name, keys: entry.keys, signature: [entry.signature, en[i].signature], doc: [entry.doc, en[i].doc] })
      })
    }
    if (section.entries.length === 0) continue
    if (SECTION_EN[title] === undefined) untranslated.push(`раздел «${title}» (SECTION_EN в tools/dts/generate.mjs)`)
    help.push(section)
  }
}
writeFileSync(
  join(root, "src", "gui", "help.generated.ts"),
  "// Создаётся tools/dts/generate.mjs из docs/API.md — не править руками. Пары строк — [русский, английский].\n" +
    "export interface HelpEntry { name: string; keys: string; signature: [string, string]; doc: [string, string] }\n" +
    "export interface HelpSection { title: [string, string]; entries: HelpEntry[]; example?: string }\n" +
    `export const HELP: HelpSection[] = ${JSON.stringify(help, null, 1)}\n` +
    // «Первые шаги» в справке: первая программа из руководства игрока («Первые 15 минут»).
    `export const FIRST_PROGRAM = ${JSON.stringify(firstProgram)}\n`,
)

// Перевод описаний обязателен: npm test (--require-en) и npm run dts (--check) падают на непереведённом.
if (untranslated.length > 0) {
  const text = `docs/API.md: без перевода (@en) — ${untranslated.length}:\n${untranslated.map((t) => `  ${t}`).join("\n")}`
  if (process.argv.includes("--require-en") || process.argv.includes("--check")) {
    console.error(text)
    process.exit(1)
  }
  console.warn(text)
}
writeFileSync(
  join(root, "src", "gui", "dts.generated.ts"),
  "// Создаётся tools/dts/generate.mjs из docs/API.md — не править руками.\n" +
    `export const DTS = ${JSON.stringify(dts)}\n` +
    // Проверке типов в игре — без списков имён (они нужны только подсказкам VS Code).
    `export const DTS_CHECK = ${JSON.stringify(plainDts)}\n` +
    `export const DTS_EN = ${JSON.stringify(dtsEn)}\n` +
    `export const TSCONFIG = ${JSON.stringify(tsconfig)}\n` +
    `export const SYNC_TOOL = ${JSON.stringify(tool)}\n` +
    `export const TS_PLUGIN = ${JSON.stringify(tsPlugin)}\n` +
    // Версия утилиты: игра отклоняет запросы утилиты другой версии (запущенной до обновления мода).
    `export const SYNC_TOOL_HASH = ${JSON.stringify(createHash("sha1").update(tool).digest("hex").slice(0, 12))}\n`,
)

// Названия имён для поиска в справке (раздел «Имена»): имя → [русский, английский].
const titles = {}
for (const n of [...names.buildings, ...names.items, ...names.fluids]) titles[n.name] ??= [n.ru, n.en]
writeFileSync(
  join(root, "src", "gui", "names.generated.ts"),
  "// Создаётся tools/dts/generate.mjs из tools/names/names.json (npm run names) — не править руками.\n" +
    `export const NAME_TITLES: Record<string, [string, string] | undefined> = ${JSON.stringify(titles)}\n`,
)

const programs = readdirSync(join(root, "examples"))
  .filter((file) => file.endsWith(".ts"))
  .sort()
  .map((file) => {
    const source = readFileSync(join(root, "examples", file), "utf8")
    const name = /^\/\/ @program (.+)$/m.exec(source)?.[1].trim()
    if (name === undefined) throw new Error(`examples/${file}: нет строки «// @program Имя»`)
    return { file, name, source }
  })
writeFileSync(
  join(root, "src", "program", "examples.generated.ts"),
  "// Создаётся tools/dts/generate.mjs из examples/*.ts — не править руками.\n" +
    `export const EXAMPLE_PROGRAMS: { name: string; source: string }[] = ${JSON.stringify(
      programs.map(({ name, source }) => ({ name, source })),
      null,
      2,
    )}\n`,
)

if (process.argv.includes("--check")) {
  const dir = join(tmpdir(), "automaton-dts-check")
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "automaton.d.ts"), dts)
  // Каждый пример — отдельный файл; moduleDetection: force делает их модулями (одинаковые имена не мешают).
  examples.forEach((source, i) => writeFileSync(join(dir, `example${i + 1}.ts`), source))
  // Программы-примеры — по своим именам (папки — подпапки), как в папке для VS Code: так проверяются и импорты
  // (и в примерах из документации: import из "./lib/Помощники").
  for (const { name, source } of programs) {
    const path = join(dir, ...name.split("/")) + ".ts"
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, source)
  }
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ ...JSON.parse(tsconfig), include: ["**/*.ts"] }))
  try {
    execFileSync(join(root, "node_modules", ".bin", "tsc"), ["-p", join(dir, "tsconfig.json")], { stdio: "pipe" })
    console.log(`automaton.d.ts: ${examples.length} примеров из API.md и руководства и ${programs.length} программ-примеров проходят tsc --strict`)
  } catch (error) {
    console.error(String(error.stdout ?? error))
    process.exit(1)
  }
}
