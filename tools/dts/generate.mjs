// Генератор automaton.d.ts (5.5): объявления API из docs/API.md (блоки ```ts с declare / type / interface).
// Пишет mod/automaton.d.ts (для игроков, VS Code) и src/gui/dts.generated.ts (окно «Типы для VS Code»,
// папка для VS Code: типы, tsconfig, утилита синхронизации mod/tools/automaton-sync.mjs, задача VS Code).
// Программы-примеры (examples/*.ts, имя — из строки «// @program Имя») — в src/program/examples.generated.ts:
// в игру сами не попадают, их публикуют /am-science и тесты (src/program/examples.ts).
// С флагом --check проверяет tsc --strict, что примеры из API.md и руководства и программы-примеры с этими
// типами компилируются.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(fileURLToPath(import.meta.url), "..", "..", "..")
const api = readFileSync(join(root, "docs", "API.md"), "utf8")
const blocks = [...api.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1])
const declarations = blocks.filter((b) => /\bdeclare\b/.test(b) || b.startsWith("type Item"))
const examples = blocks.filter((b) => !declarations.includes(b))
// Примеры из руководства игрока — тоже программы, они должны проходить tsc.
for (const doc of [join(root, "docs", "PLAYER_GUIDE.md"), join(root, "README.md")]) {
  for (const m of readFileSync(doc, "utf8").matchAll(/```ts\n([\s\S]*?)```/g)) examples.push(m[1])
}

const headerEn = `// Automaton API types (the Automaton mod for Factorio) — for the VS Code editor.
// Easiest: in the game, the "Team programs" window → "VS Code folder" — the mod writes a ready folder
// (programs, this file, tsconfig.json, sync with the game). By hand:
//   1. Create a folder and put this file and tsconfig.json in it:
//      { "compilerOptions": { "strict": true, "target": "es2020", "lib": ["es2020"], "noEmit": true, "moduleDetection": "force",
//        "module": "preserve", "moduleResolution": "bundler" } }
//   2. Write the program in a .ts file next to it — VS Code suggests functions and finds errors.
//   3. Copy the program text into the "Team programs" window in the game and press "Publish".
// Language and API reference — docs/API.md and docs/LANGUAGE.md (github.com/zawert879/factorio-automanton).
`
const header = `// Типы API автоматонов (мод Automaton для Factorio) — для редактора VS Code.
// Проще всего: в игре окно «Программы команды» → «Папка для VS Code» — мод запишет готовую папку
// (программы, этот файл, tsconfig.json, синхронизацию с игрой). Вручную:
//   1. Создайте папку, положите в неё этот файл и tsconfig.json:
//      { "compilerOptions": { "strict": true, "target": "es2020", "lib": ["es2020"], "noEmit": true, "moduleDetection": "force",
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
      lib: ["es2020"],
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
const dts = header + "\n" + localize(declarations.join("\n"), "ru")
const dtsEn = headerEn + "\n" + localize(declarations.join("\n"), "en")
writeFileSync(join(root, "mod", "automaton.d.ts"), dts)
writeFileSync(join(root, "mod", "automaton.en.d.ts"), dtsEn)
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
    `export const DTS_EN = ${JSON.stringify(dtsEn)}\n` +
    `export const TSCONFIG = ${JSON.stringify(tsconfig)}\n` +
    `export const SYNC_TOOL = ${JSON.stringify(tool)}\n` +
    `export const TS_PLUGIN = ${JSON.stringify(tsPlugin)}\n` +
    // Версия утилиты: игра отклоняет запросы утилиты другой версии (запущенной до обновления мода).
    `export const SYNC_TOOL_HASH = ${JSON.stringify(createHash("sha1").update(tool).digest("hex").slice(0, 12))}\n`,
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
