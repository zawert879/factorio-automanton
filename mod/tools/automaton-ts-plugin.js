// Плагин TypeScript для программ автоматонов (VS Code). Подключается tsconfig.json папки программ
// ("plugins": [{ "name": "automaton-ts-plugin" }]) и проверяет только файлы в её src — другие проекты не трогает.
// - Ошибки на возможностях TypeScript, которых нет в языке машин (async/await, var, enum, регулярные
//   выражения, == …) — те же, что даст игра при публикации (docs/LANGUAGE.md, «Не поддерживается»).
// - Подсказки о времени (docs/API.md, «Время программы»): наведите на for / while — цена витка и сколько
//   тиков займёт цикл с известным числом витков; на publish, sort, map, JSON.parse — цена вызова.
"use strict"

/** Квант рабочих моделей (src/names.ts, quantum). */
const QUANTA = [
  ["Mk1", 50],
  ["Mk2", 100],
  ["Mk3", 200],
]

/** Функции, которые ждут (действия, ожидание) — src/lang/builtins.ts, HOST_FUNCTIONS со значением true. */
const WAITING = new Set([
  "move", "canReach", "follow", "goHome", "mine", "take", "put", "pickup", "drop", "give", "repair", "setRecipe",
  "build", "deconstruct", "rotate", "pump", "fill", "drain", "refuel", "charge", "attack", "guard", "patrol", "reload",
  "receive", "request", "wait", "waitUntil",
])

const TEXT = {
  ru: {
    unsupported: "Не поддерживается в программах машин: ",
    features: {
      var: "var — используйте let или const",
      async: "async/await — действия и так ждут, пока закончатся",
      generator: "генераторы (function*, yield)",
      enum: "enum — используйте объединение строк: type Ore = \"coal\" | \"iron-ore\"",
      namespace: "namespace — используйте модули (import / export)",
      declare: "declare в программе",
      debugger: "debugger",
      with: "with",
      "for-in": "for…in — используйте for…of и Object.keys",
      regex: "регулярные выражения",
      delete: "delete",
      "accessor-in-object": "геттеры и сеттеры в объектах",
      setter: "сеттеры в классах",
      "static-getter": "статические геттеры",
      "label-not-loop": "метка не у цикла",
      equality: "== и != — используйте === и !==",
      "private-name": "#приватные поля — используйте private",
      decorator: "декораторы",
      "tagged-template": "тегированные шаблоны",
      "new.target": "new.target",
      "import.meta": "import.meta",
      "dynamic-import": "import(…) — пишите import … from \"./модуль\" в начале программы",
      "export-assignment": "export = — пишите export default",
      "import-require": "import x = require(…) — пишите import … from",
      "export-star-as": "export * as имя",
      bigint: "BigInt",
      arguments: "arguments — используйте ...параметры",
      "computed-member": "вычисляемые имена членов класса",
      reserved: "имена на __ зарезервированы",
    },
    loop: "Цикл: каждый виток — 1 инструкция кванта.",
    perTick: (list) => `За тик: ${list}.`,
    noWaitTail: "Длинный цикл без ожиданий растягивается на несколько тиков — это не ошибка.",
    waitTail: (name) => `В витке есть ожидание (${name}) — время цикла в основном займёт оно; квант тратится только на сам виток.`,
    known: (n, list) => `${n} ${plural(n, "виток", "витка", "витков")}: ${list}.`,
    ticks: (model, t) => `${model} — ${t} ${plural(t, "тик", "тика", "тиков")}`,
    seconds: (s) => `≈ ${s} с на Mk1`,
    costs: {
      publish: "publish: 1 инструкция кванта за каждого подписчика, письма уходят сразу; перерасход кванта машина отрабатывает, пропуская тики.",
      sort: "sort: 1 инструкция на 8 элементов, сразу.",
      each: "1 инструкция за элемент: сразу, если в лямбде нет ожиданий (перерасход — пропуск тиков), иначе с паузами, как цикл.",
      parse: "JSON.parse: 1 инструкция на 256 символов текста.",
      stringify: "JSON.stringify: 1 инструкция за каждый объект и массив.",
    },
  },
  en: {
    unsupported: "Not supported in robot programs: ",
    features: {
      var: "var — use let or const",
      async: "async/await — actions already wait until done",
      generator: "generators (function*, yield)",
      enum: "enum — use a string union: type Ore = \"coal\" | \"iron-ore\"",
      namespace: "namespace — use modules (import / export)",
      declare: "declare in a program",
      debugger: "debugger",
      with: "with",
      "for-in": "for…in — use for…of and Object.keys",
      regex: "regular expressions",
      delete: "delete",
      "accessor-in-object": "getters and setters in object literals",
      setter: "setters in classes",
      "static-getter": "static getters",
      "label-not-loop": "label on a non-loop statement",
      equality: "== and != — use === and !==",
      "private-name": "#private fields — use private",
      decorator: "decorators",
      "tagged-template": "tagged templates",
      "new.target": "new.target",
      "import.meta": "import.meta",
      "dynamic-import": "import(…) — write import … from \"./module\" at the top",
      "export-assignment": "export = — write export default",
      "import-require": "import x = require(…) — write import … from",
      "export-star-as": "export * as name",
      bigint: "BigInt",
      arguments: "arguments — use ...rest parameters",
      "computed-member": "computed class member names",
      reserved: "names starting with __ are reserved",
    },
    loop: "Loop: every iteration costs 1 instruction of the quantum.",
    perTick: (list) => `Per tick: ${list}.`,
    noWaitTail: "A long loop without waiting spreads over several ticks — that is not an error.",
    waitTail: (name) => `The loop body waits (${name}) — that wait takes most of the time; the quantum pays only for the iteration itself.`,
    known: (n, list) => `${n} iterations: ${list}.`,
    ticks: (model, t) => `${model} — ${t} tick${t === 1 ? "" : "s"}`,
    seconds: (s) => `≈ ${s} s on Mk1`,
    costs: {
      publish: "publish: 1 instruction per subscriber, messages leave at once; the robot pays the overspent quantum by skipping ticks.",
      sort: "sort: 1 instruction per 8 elements, at once.",
      each: "1 instruction per element: at once if the callback does not wait (overspend — skipped ticks), otherwise with pauses, like a loop.",
      parse: "JSON.parse: 1 instruction per 256 characters of text.",
      stringify: "JSON.stringify: 1 instruction per object and array.",
    },
  },
}

const EACH = new Set(["forEach", "map", "filter", "find", "findIndex", "findLast", "findLastIndex", "some", "every", "reduce", "reduceRight", "flatMap"])
const DIAGNOSTIC_CODE = 9400
const SUGGESTION_CODE = 9401

function plural(n, one, few, many) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

/** Найти возможности TypeScript, которых нет в языке машин. Результат — [{ start, length, feature }]. */
function unsupported(ts, sourceFile) {
  const found = []
  const add = (node, feature, start, length) => {
    const from = start ?? node.getStart(sourceFile)
    found.push({ start: from, length: length ?? Math.max(1, node.getEnd() - from), feature })
  }
  const hasModifier = (node, kind) => (ts.canHaveModifiers?.(node) ? ts.getModifiers(node) : node.modifiers)?.some((m) => m.kind === kind)
  const LOOPS = new Set([ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForOfStatement, ts.SyntaxKind.ForInStatement, ts.SyntaxKind.WhileStatement, ts.SyntaxKind.DoStatement])
  const visit = (node) => {
    const k = ts.SyntaxKind
    switch (node.kind) {
      case k.VariableDeclarationList:
        if ((node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0) add(node, "var", node.getStart(sourceFile), 3)
        break
      case k.AwaitExpression:
        add(node, "async", node.getStart(sourceFile), 5)
        break
      case k.YieldExpression:
        add(node, "generator", node.getStart(sourceFile), 5)
        break
      case k.EnumDeclaration:
        add(node, "enum", node.getStart(sourceFile), 4)
        break
      case k.ModuleDeclaration:
        add(node, "namespace", node.getStart(sourceFile), node.name.getEnd() - node.getStart(sourceFile))
        break
      case k.DebuggerStatement:
        add(node, "debugger")
        break
      case k.WithStatement:
        add(node, "with", node.getStart(sourceFile), 4)
        break
      case k.ForInStatement:
        add(node, "for-in", node.getStart(sourceFile), 3)
        break
      case k.RegularExpressionLiteral:
        add(node, "regex")
        break
      case k.DeleteExpression:
        add(node, "delete", node.getStart(sourceFile), 6)
        break
      case k.GetAccessor:
      case k.SetAccessor:
        if (node.parent.kind === k.ObjectLiteralExpression) add(node, "accessor-in-object", node.getStart(sourceFile), 3)
        else if (node.kind === k.SetAccessor) add(node, "setter", node.getStart(sourceFile), 3)
        else if (hasModifier(node, k.StaticKeyword)) add(node, "static-getter", node.getStart(sourceFile), 6)
        break
      case k.LabeledStatement:
        if (!LOOPS.has(node.statement.kind)) add(node.label, "label-not-loop")
        break
      case k.BinaryExpression:
        if (node.operatorToken.kind === k.EqualsEqualsToken || node.operatorToken.kind === k.ExclamationEqualsToken) add(node.operatorToken, "equality")
        break
      case k.PrivateIdentifier:
        add(node, "private-name")
        break
      case k.Decorator:
        add(node, "decorator")
        break
      case k.TaggedTemplateExpression:
        add(node.tag, "tagged-template")
        break
      case k.MetaProperty:
        add(node, node.keywordToken === k.NewKeyword ? "new.target" : "import.meta")
        break
      case k.CallExpression:
        if (node.expression.kind === k.ImportKeyword) add(node.expression, "dynamic-import")
        break
      case k.ExportAssignment:
        if (node.isExportEquals) add(node, "export-assignment", node.getStart(sourceFile), 8)
        break
      case k.ImportEqualsDeclaration:
        add(node, "import-require", node.getStart(sourceFile), 6)
        break
      case k.ExportDeclaration:
        if (node.exportClause?.kind === k.NamespaceExport) add(node.exportClause, "export-star-as")
        break
      case k.BigIntLiteral:
        add(node, "bigint")
        break
      case k.Identifier:
        if (node.text === "arguments" && isExpression(ts, node)) add(node, "arguments")
        else if (node.text.startsWith("__")) add(node, "reserved")
        break
      case k.ComputedPropertyName:
        if (ts.isClassElement(node.parent)) add(node, "computed-member")
        break
    }
    if (ts.isFunctionLike(node)) {
      if (hasModifier(node, k.AsyncKeyword)) add(node, "async", node.getStart(sourceFile), 5)
      if (node.asteriskToken) add(node.asteriskToken, "generator")
    }
    if (hasModifier(node, k.DeclareKeyword)) add(node, "declare", node.getStart(sourceFile), 7)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

/** Имя в позиции выражения (а не имя свойства, параметра или объявления). */
function isExpression(ts, node) {
  const parent = node.parent
  if (!parent) return false
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false
  if ((ts.isParameter(parent) || ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent)) && parent.name === node) return false
  return true
}

/** Число витков цикла, если оно видно из кода: for (let i = 0; i < 100; i++), for (const x of [1, 2, 3]). */
function iterations(ts, loop) {
  const num = (e) => (e && ts.isNumericLiteral(e) ? Number(e.text) : e && ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(e.operand) ? -Number(e.operand.text) : undefined)
  if (ts.isForOfStatement(loop)) return ts.isArrayLiteralExpression(loop.expression) ? loop.expression.elements.length : undefined
  if (!ts.isForStatement(loop) || !loop.initializer || !ts.isVariableDeclarationList(loop.initializer)) return undefined
  const decl = loop.initializer.declarations[0]
  if (!decl || !ts.isIdentifier(decl.name)) return undefined
  const name = decl.name.text
  const from = num(decl.initializer)
  const cond = loop.condition
  if (from === undefined || !cond || !ts.isBinaryExpression(cond) || !ts.isIdentifier(cond.left) || cond.left.text !== name) return undefined
  const to = num(cond.right)
  if (to === undefined) return undefined
  let step
  const inc = loop.incrementor
  if (inc && (ts.isPostfixUnaryExpression(inc) || ts.isPrefixUnaryExpression(inc)) && ts.isIdentifier(inc.operand) && inc.operand.text === name) {
    step = inc.operator === ts.SyntaxKind.PlusPlusToken ? 1 : inc.operator === ts.SyntaxKind.MinusMinusToken ? -1 : undefined
  } else if (inc && ts.isBinaryExpression(inc) && ts.isIdentifier(inc.left) && inc.left.text === name) {
    const by = num(inc.right)
    if (by !== undefined && inc.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) step = by
    if (by !== undefined && inc.operatorToken.kind === ts.SyntaxKind.MinusEqualsToken) step = -by
  }
  if (!step) return undefined
  const op = cond.operatorToken.kind
  const k = ts.SyntaxKind
  let span
  if (step > 0 && op === k.LessThanToken) span = to - from
  else if (step > 0 && op === k.LessThanEqualsToken) span = to - from + 1
  else if (step < 0 && op === k.GreaterThanToken) span = from - to
  else if (step < 0 && op === k.GreaterThanEqualsToken) span = from - to + 1
  else return undefined
  return Math.max(0, Math.ceil(span / Math.abs(step)))
}

/** Первая ожидающая функция в теле цикла (move, wait…), если есть. */
function waitingCall(ts, loop) {
  let found
  const visit = (node) => {
    if (found) return
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee) && WAITING.has(callee.text)) found = callee.text
      else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "tasks" && callee.name.text === "next") found = "tasks.next"
    }
    // Вложенные функции не исполняются в витке сами по себе.
    if (!ts.isFunctionLike(node)) ts.forEachChild(node, visit)
  }
  visit(loop.statement)
  return found
}

/** Текст подсказки о цикле и (если число витков известно) коротко — для подсказки «…». */
function loopHint(ts, loop, lang) {
  const t = TEXT[lang] ?? TEXT.ru
  const perTick = t.perTick(QUANTA.map(([m, q]) => `${m} — ${q}`).join(", "))
  const n = iterations(ts, loop)
  const wait = waitingCall(ts, loop)
  const lines = [t.loop, perTick]
  let short
  if (n !== undefined) {
    const list = QUANTA.map(([m, q]) => t.ticks(m, Math.max(1, Math.ceil(n / q)))).join(", ")
    short = `${t.known(n, list)}${wait ? "" : ` ${t.seconds((Math.ceil(n / QUANTA[0][1]) / 60).toFixed(2))}`}`
    lines.push(short)
  }
  lines.push(wait ? t.waitTail(wait) : t.noWaitTail)
  return { text: lines.join("\n"), short: n !== undefined && n > QUANTA[0][1] && !wait ? short : undefined }
}

/** Цена вызова тяжёлой функции библиотеки (если это она). */
function callCost(ts, node, lang) {
  const t = (TEXT[lang] ?? TEXT.ru).costs
  if (ts.isIdentifier(node) && node.text === "publish") return t.publish
  if (ts.isIdentifier(node) && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
    const name = node.text
    const owner = node.parent.expression
    if (ts.isIdentifier(owner) && owner.text === "JSON") return name === "parse" ? t.parse : name === "stringify" ? t.stringify : undefined
    if (name === "sort") return t.sort
    if (EACH.has(name)) return `${name}: ${t.each}`
  }
  return undefined
}

function isLoop(ts, node) {
  return ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)
}

/** Узел в позиции (самый глубокий). */
function nodeAt(ts, sourceFile, position) {
  let found
  const visit = (node) => {
    if (position >= node.getStart(sourceFile) && position < node.getEnd()) {
      found = node
      ts.forEachChild(node, visit)
    }
  }
  visit(sourceFile)
  return found
}

function init(modules) {
  const ts = modules.typescript

  function create(info) {
    const ls = info.languageService
    const config = info.config ?? {}
    const lang = config.lang === "en" ? "en" : "ru"
    const root = String(info.project.getCurrentDirectory()).replace(/\\/g, "/")
    /** Только программы: файлы в src папки, где лежит tsconfig.json с этим плагином. */
    const ours = (fileName) => fileName.replace(/\\/g, "/").startsWith(`${root}/src/`) && !fileName.endsWith(".d.ts")
    const source = (fileName) => ls.getProgram()?.getSourceFile(fileName)

    const proxy = Object.create(null)
    for (const key of Object.keys(ls)) proxy[key] = (...args) => ls[key](...args)

    proxy.getSemanticDiagnostics = (fileName) => {
      const prior = ls.getSemanticDiagnostics(fileName)
      const sf = ours(fileName) ? source(fileName) : undefined
      if (!sf) return prior
      const t = TEXT[lang]
      return prior.concat(
        unsupported(ts, sf).map((u) => ({
          file: sf,
          start: u.start,
          length: u.length,
          messageText: t.unsupported + (t.features[u.feature] ?? u.feature),
          category: ts.DiagnosticCategory.Error,
          code: DIAGNOSTIC_CODE,
          source: "automaton",
        })),
      )
    }

    proxy.getSuggestionDiagnostics = (fileName) => {
      const prior = ls.getSuggestionDiagnostics(fileName)
      const sf = ours(fileName) ? source(fileName) : undefined
      if (!sf) return prior
      const extra = []
      const visit = (node) => {
        if (isLoop(ts, node)) {
          const hint = loopHint(ts, node, lang)
          if (hint.short) {
            const start = node.getStart(sf)
            extra.push({ file: sf, start, length: node.kind === ts.SyntaxKind.WhileStatement ? 5 : 3, messageText: hint.short, category: ts.DiagnosticCategory.Suggestion, code: SUGGESTION_CODE, source: "automaton" })
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
      return prior.concat(extra)
    }

    proxy.getQuickInfoAtPosition = (fileName, position) => {
      const prior = ls.getQuickInfoAtPosition(fileName, position)
      const sf = ours(fileName) ? source(fileName) : undefined
      if (!sf) return prior
      const node = nodeAt(ts, sf, position)
      if (!node) return prior
      // Ключевое слово цикла: for / while / do.
      const keyword = node.kind === ts.SyntaxKind.ForKeyword || node.kind === ts.SyntaxKind.WhileKeyword || node.kind === ts.SyntaxKind.DoKeyword
      const loop = keyword && node.parent && isLoop(ts, node.parent) ? node.parent : isLoop(ts, node) && position < node.getStart(sf) + 5 ? node : undefined
      if (loop) {
        const hint = loopHint(ts, loop, lang)
        const word = ts.isWhileStatement(loop) ? "while" : ts.isDoStatement(loop) ? "do" : "for"
        return {
          kind: ts.ScriptElementKind.keyword,
          kindModifiers: "",
          textSpan: { start: loop.getStart(sf), length: word.length },
          displayParts: [{ text: word, kind: "keyword" }],
          documentation: [{ text: hint.text, kind: "text" }],
        }
      }
      const cost = callCost(ts, node, lang)
      if (cost && prior) return { ...prior, documentation: [...(prior.documentation ?? []), { text: `\n\n${cost}`, kind: "text" }] }
      return prior
    }
    return proxy
  }

  return { create }
}

module.exports = init
/** Для тестов (tools/test/tsplugin.mjs). */
module.exports.internals = { unsupported, iterations, loopHint, callCost, WAITING, QUANTA }
