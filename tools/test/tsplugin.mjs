// Плагин TypeScript для VS Code (mod/tools/automaton-ts-plugin.js): ошибки на неподдерживаемом, без ложных
// срабатываний на программах-примерах и примерах из документации, подсказки о тиках, только файлы src папки программ.
// Подсветка (25.3): отметка «плагин загружен» и путь к плагину в settings.json VS Code (node automaton-sync.mjs plugin).
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ts from "typescript"
import { isDeclarationBlock } from "../dts/blocks.mjs"

export function checkTsPlugin(root) {
  const problems = []
  const require = createRequire(import.meta.url)
  const plugin = require(join(root, "mod", "tools", "automaton-ts-plugin.js"))
  const { unsupported, iterations, loopHint, callCost, unknownNames, WAITING, WAITING_METHODS } = plugin.internals
  const sourceOf = (code) => ts.createSourceFile("x.ts", code, ts.ScriptTarget.ES2020, true)
  const features = (code) => unsupported(ts, sourceOf(code)).map((u) => u.feature).sort().join(",")
  const expect = (what, got, want) => {
    if (got !== want) problems.push(`${what}: получено «${got}», ожидалось «${want}»`)
  }

  expect("var", features("var x = 1"), "var")
  expect("async/await", features("async function f() { await g() }"), "async,async")
  expect("генератор", features("function* g() { yield 1 }"), "generator,generator")
  expect("регулярка и ==", features("const r = /a+/\nif (a == b) {}"), "equality,regex")
  expect("enum, namespace, for…in", features("enum E { A }\nnamespace N {}\nfor (const k in o) {}"), "enum,for-in,namespace")
  expect("#поле, delete, метка", features("class A { #x = 1 }\ndelete o.a\nl: if (x) {}"), "delete,label-not-loop,private-name")
  expect("import(), export =", features("const m = import('./x')\nexport = 5"), "dynamic-import,export-assignment")
  expect("разрешённое", features(`import { a } from "./lib"\nexport class B extends A { get x() { return 1 } }\nconst f = async`), "")

  // Без ложных срабатываний: программы-примеры и программы из документации.
  for (const file of readdirSync(join(root, "examples")).filter((f) => f.endsWith(".ts"))) {
    expect(`examples/${file}`, features(readFileSync(join(root, "examples", file), "utf8")), "")
  }
  for (const doc of ["docs/API.md", "docs/PLAYER_GUIDE.md", "README.md"]) {
    let i = 0
    for (const m of readFileSync(join(root, doc), "utf8").matchAll(/```ts\n([\s\S]*?)```/g)) {
      i++
      if (isDeclarationBlock(m[1])) continue
      expect(`${doc} #${i}`, features(m[1]), "")
    }
  }

  // Имена не из словаря (24.1): опечатка — предупреждение и похожее имя; верные имена, имена в массиве и не-имена — нет.
  const namesDir = mkdtempSync(join(tmpdir(), "automaton-names-"))
  writeFileSync(join(namesDir, "automaton.d.ts"), readFileSync(join(root, "mod", "automaton.d.ts")))
  writeFileSync(
    join(namesDir, "x.ts"),
    `const chest = scan.buildings({ kind: Chest, name: ["wooden-chest", "iron-chst"] })[0]\n` +
      `chest.extract("iron-plat")\nchest.extract("copper-plate")\nzone("плавильня").find("stone-furnace")\nprint("iron-plat")\n`,
  )
  const program = ts.createProgram([join(namesDir, "x.ts"), join(namesDir, "automaton.d.ts")], { strict: true, target: ts.ScriptTarget.ES2020, noLib: true, noEmit: true, moduleDetection: ts.ModuleDetectionKind.Force })
  const unknown = unknownNames(ts, program.getSourceFile(join(namesDir, "x.ts")), program.getTypeChecker())
  expect("имена не из словаря", unknown.map((u) => `${u.name}>${u.near}`).join(","), "iron-chst>iron-chest,iron-plat>iron-plate")
  // В примерах и документации все имена — из словаря.
  const samples = []
  for (const file of readdirSync(join(root, "examples")).filter((f) => f.endsWith(".ts"))) samples.push([`examples/${file}`, readFileSync(join(root, "examples", file), "utf8")])
  for (const doc of ["docs/API.md", "docs/PLAYER_GUIDE.md", "README.md", "docs/en/PLAYER_GUIDE.md", "README.en.md"]) {
    let i = 0
    for (const m of readFileSync(join(root, doc), "utf8").matchAll(/```ts\n([\s\S]*?)```/g)) {
      i++
      if (!isDeclarationBlock(m[1])) samples.push([`${doc} #${i}`, m[1]])
    }
  }
  samples.forEach(([name, code], i) => writeFileSync(join(namesDir, `s${i}.ts`), code))
  const all = ts.createProgram([...samples.map((_, i) => join(namesDir, `s${i}.ts`)), join(namesDir, "automaton.d.ts")], { strict: true, target: ts.ScriptTarget.ES2020, noLib: true, noEmit: true, moduleDetection: ts.ModuleDetectionKind.Force, noResolve: true })
  samples.forEach(([name], i) => {
    const found = unknownNames(ts, all.getSourceFile(join(namesDir, `s${i}.ts`)), all.getTypeChecker())
    expect(`имена в ${name}`, found.map((u) => u.name).join(","), "")
  })

  // Число витков и тики.
  const loopOf = (code) => sourceOf(code).statements[0]
  expect("for 0..1000", iterations(ts, loopOf("for (let i = 0; i < 1000; i++) {}")), 1000)
  expect("for <= с шагом", iterations(ts, loopOf("for (let i = 1; i <= 10; i += 2) {}")), 5)
  expect("for вниз", iterations(ts, loopOf("for (let i = 10; i > 0; i--) {}")), 10)
  expect("for…of литерала", iterations(ts, loopOf("for (const x of [1, 2, 3]) {}")), 3)
  expect("неизвестно", iterations(ts, loopOf("for (const x of items) {}")), undefined)
  expect("подсказка 1000 витков", loopHint(ts, loopOf("for (let i = 0; i < 1000; i++) {}"), "ru").short, "1000 витков: Mk1 — 20 тиков, Mk2 — 10 тиков, Mk3 — 5 тиков. ≈ 0.33 с на Mk1")
  expect("цикл с ожиданием — без «…»", loopHint(ts, loopOf("for (let i = 0; i < 1000; i++) { me.move(p) }"), "ru").short, undefined)
  expect("ожидание метода здания", loopHint(ts, loopOf("for (let i = 0; i < 1000; i++) { furnace.insert('coal') }"), "ru").text.includes("furnace.insert"), true)
  const pub = sourceOf("radio.publish('a', 1)").statements[0].expression.expression.name
  expect("цена radio.publish", (callCost(ts, pub, "ru") ?? "").startsWith("radio.publish: 1 инструкция"), true)

  // Ожидающие функции — те же, что у компилятора (src/lang/builtins.ts, HOST_FUNCTIONS: true).
  const builtins = readFileSync(join(root, "src", "lang", "builtins.ts"), "utf8")
  const block = /const HOST_FUNCTIONS[^{]*\{([\s\S]*?)\n\}/.exec(builtins)[1]
  const blocking = [...block.matchAll(/^\s+(\w+): true,/gm)].map((m) => m[1]).sort().join(",")
  expect("ожидающие функции", [...WAITING].sort().join(","), blocking)
  // Ожидающие методы — те же, что у компилятора (BLOCKING_OBJECT_METHODS и методы в BLOCKING_HOST_METHODS, кроме tasks.next).
  const objectMethods = /export const BLOCKING_OBJECT_METHODS = \[([\s\S]*?)\]/.exec(builtins)[1]
  const hostMethods = /export const BLOCKING_HOST_METHODS[^{]*\{([\s\S]*?)\n\}/.exec(builtins)[1]
  const methods = [...objectMethods.matchAll(/"(\w+)"/g), ...hostMethods.matchAll(/(\w+): true/g)].map((m) => m[1]).filter((m) => m !== "next")
  expect("ожидающие методы", [...WAITING_METHODS].sort().join(","), [...new Set(methods)].sort().join(","))

  // В языковом сервисе: ошибки — только у файлов src папки программ.
  const dir = mkdtempSync(join(tmpdir(), "automaton-tsplugin-"))
  mkdirSync(join(dir, "src"))
  mkdirSync(join(dir, ".automaton"))
  const files = { [join(dir, "src", "a.ts")]: "var x = 1\nfor (let i = 0; i < 500; i++) {}\n", [join(dir, "other.ts")]: "var y = 2\n" }
  for (const [file, text] of Object.entries(files)) writeFileSync(file, text)
  const host = {
    getScriptFileNames: () => Object.keys(files),
    getScriptVersion: () => "1",
    getScriptSnapshot: (f) => (files[f] !== undefined ? ts.ScriptSnapshot.fromString(files[f]) : ts.sys.fileExists(f) ? ts.ScriptSnapshot.fromString(ts.sys.readFile(f)) : undefined),
    getCurrentDirectory: () => dir,
    getCompilationSettings: () => ({ strict: true, target: ts.ScriptTarget.ES2020, noEmit: true, types: [] }),
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
  }
  const service = plugin({ typescript: ts }).create({ languageService: ts.createLanguageService(host), project: { getCurrentDirectory: () => dir }, config: { lang: "ru" } })
  const ours = service.getSemanticDiagnostics(join(dir, "src", "a.ts")).filter((d) => d.source === "automaton")
  expect("ошибка в src", ours.length, 1)
  expect("текст ошибки", String(ours[0]?.messageText).startsWith("Не поддерживается в программах машин: var"), true)
  expect("вне src не проверяется", service.getSemanticDiagnostics(join(dir, "other.ts")).filter((d) => d.source === "automaton").length, 0)
  expect("подсказка «…» у цикла", service.getSuggestionDiagnostics(join(dir, "src", "a.ts")).some((d) => String(d.messageText).startsWith("500 витков")), true)
  const info = service.getQuickInfoAtPosition(join(dir, "src", "a.ts"), files[join(dir, "src", "a.ts")].indexOf("for") + 1)
  expect("наведение на for", (info?.documentation ?? []).map((d) => d.text).join("").includes("Цикл: каждый виток — 1 инструкция кванта"), true)
  // Загрузился — отметка для утилиты синхронизации (окно «VS Code» ставит галочку).
  expect("отметка «плагин загружен»", existsSync(join(dir, ".automaton", "plugin.json")), true)

  // Путь к плагину в settings.json VS Code: только вставка — комментарии, порядок и прежние пути остаются.
  const tool = join(root, "mod", "tools", "automaton-sync.mjs")
  const settings = join(dir, "settings.json")
  const enable = (text) => {
    if (text === undefined) spawnSync("rm", ["-f", settings])
    else writeFileSync(settings, text)
    const run = spawnSync(process.execPath, [tool, "plugin", "--settings", settings], { encoding: "utf8" })
    return { code: run.status, out: run.stdout, text: existsSync(settings) ? readFileSync(settings, "utf8") : undefined }
  }
  const OLD = '"typescript.tsserver.pluginPaths"'
  const NEW = '"js/ts.tsserver.pluginPaths"'
  expect("нет файла", enable(undefined).text, `{\n  ${OLD}: ["./.automaton"]\n}\n`)
  expect("пустой объект", enable("{}").text, `{\n  ${OLD}: ["./.automaton"]\n}`)
  const commented = '// мои настройки\n{\n  // шрифт\n  "editor.fontSize": 14, /* { [ */\n  "a": { "b": [1, 2], },\n}\n'
  const added = enable(commented)
  expect("с комментариями", added.text, `// мои настройки\n{\n  ${OLD}: ["./.automaton"],\n  // шрифт\n  "editor.fontSize": 14, /* { [ */\n  "a": { "b": [1, 2], },\n}\n`)
  expect("копия прежних", readFileSync(`${settings}.automaton-backup`, "utf8"), commented)
  expect("сообщение", added.out.includes("подсветка ошибок языка включена"), true)
  expect("второй раз — уже есть", enable(added.text).out.includes("уже есть"), true)
  expect("свой путь в массиве", enable(`{ ${OLD}: ["/x"] }`).text, `{ ${OLD}: ["./.automaton", "/x"] }`)
  expect("пустой массив", enable(`{ ${OLD}: [] }`).text, `{ ${OLD}: ["./.automaton"] }`)
  expect("новое имя настройки", enable(`{ ${NEW}: ["/x"], "b": 1 }`).text, `{ ${NEW}: ["./.automaton", "/x"], "b": 1 }`)
  expect("оба имени", enable(`{ ${NEW}: [], ${OLD}: ["./.automaton"] }`).text, `{ ${NEW}: ["./.automaton"], ${OLD}: ["./.automaton"] }`)
  expect("ключ внутри объекта — не тот", enable(`{ "x": { ${OLD}: [] } }`).text, `{\n  ${OLD}: ["./.automaton"], "x": { ${OLD}: [] } }`)
  const broken = enable('{ "a": 1 "b": 2 }')
  expect("не разобрать — не трогать", `${broken.code} ${broken.text}`, '1 { "a": 1 "b": 2 }')
  expect("одни комментарии", enable("// пусто\n").text, `// пусто\n{\n  ${OLD}: ["./.automaton"]\n}\n`)
  return problems
}
