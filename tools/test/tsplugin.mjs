// Плагин TypeScript для VS Code (mod/tools/automaton-ts-plugin.js): ошибки на неподдерживаемом, без ложных
// срабатываний на стартовых программах и примерах, подсказки о тиках, только файлы src папки программ.
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ts from "typescript"

export function checkTsPlugin(root) {
  const problems = []
  const require = createRequire(import.meta.url)
  const plugin = require(join(root, "mod", "tools", "automaton-ts-plugin.js"))
  const { unsupported, iterations, loopHint, callCost, WAITING } = plugin.internals
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

  // Без ложных срабатываний: стартовые программы и программы из документации.
  for (const file of readdirSync(join(root, "examples")).filter((f) => f.endsWith(".ts"))) {
    expect(`examples/${file}`, features(readFileSync(join(root, "examples", file), "utf8")), "")
  }
  for (const doc of ["docs/API.md", "docs/PLAYER_GUIDE.md", "README.md"]) {
    let i = 0
    for (const m of readFileSync(join(root, doc), "utf8").matchAll(/```ts\n([\s\S]*?)```/g)) {
      i++
      if (/\bdeclare\b/.test(m[1]) || m[1].startsWith("type Item")) continue
      expect(`${doc} #${i}`, features(m[1]), "")
    }
  }

  // Число витков и тики.
  const loopOf = (code) => sourceOf(code).statements[0]
  expect("for 0..1000", iterations(ts, loopOf("for (let i = 0; i < 1000; i++) {}")), 1000)
  expect("for <= с шагом", iterations(ts, loopOf("for (let i = 1; i <= 10; i += 2) {}")), 5)
  expect("for вниз", iterations(ts, loopOf("for (let i = 10; i > 0; i--) {}")), 10)
  expect("for…of литерала", iterations(ts, loopOf("for (const x of [1, 2, 3]) {}")), 3)
  expect("неизвестно", iterations(ts, loopOf("for (const x of items) {}")), undefined)
  expect("подсказка 1000 витков", loopHint(ts, loopOf("for (let i = 0; i < 1000; i++) {}"), "ru").short, "1000 витков: Mk1 — 20 тиков, Mk2 — 10 тиков, Mk3 — 5 тиков. ≈ 0.33 с на Mk1")
  expect("цикл с ожиданием — без «…»", loopHint(ts, loopOf("for (let i = 0; i < 1000; i++) { move(p) }"), "ru").short, undefined)
  const pub = sourceOf("publish('a', 1)").statements[0].expression.expression
  expect("цена publish", (callCost(ts, pub, "ru") ?? "").startsWith("publish: 1 инструкция"), true)

  // Ожидающие функции — те же, что у компилятора (src/lang/builtins.ts, HOST_FUNCTIONS: true).
  const builtins = readFileSync(join(root, "src", "lang", "builtins.ts"), "utf8")
  const block = /const HOST_FUNCTIONS[^{]*\{([\s\S]*?)\n\}/.exec(builtins)[1]
  const blocking = [...block.matchAll(/^\s+(\w+): true,/gm)].map((m) => m[1]).sort().join(",")
  expect("ожидающие функции", [...WAITING].sort().join(","), blocking)

  // В языковом сервисе: ошибки — только у файлов src папки программ.
  const dir = mkdtempSync(join(tmpdir(), "automaton-tsplugin-"))
  mkdirSync(join(dir, "src"))
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
  return problems
}
