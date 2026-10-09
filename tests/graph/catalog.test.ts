// Каждый узел каталога (D2 — всё API машин) в маленькой схеме: входы — значениями из настроек или проводами
// от узла нужного типа, действие — после «Старта». Код собирается и проходит проверку типов.
import { describe, expect, test } from "../../src/test/testing"
import { compile } from "../../src/lang/codegen"
import { GraphBuilder } from "../../src/graph/builder"
import { graphToSource, resolvePins } from "../../src/graph/codegen"
import { GraphNode, PinType } from "../../src/graph/model"
import { NODES } from "../../src/graph/nodes"
import "../lang/api-stubs"

/** Узлы порядка, переменные и функции проверяются в codegen.test.ts. */
const SPECIAL = ["start", "if", "forever", "while", "repeat", "foreach", "break", "continue", "try", "variable", "variable-get", "variable-set", "function", "return", "call"]

/** Значение для входа без провода (если его можно задать в настройках). */
const INLINE: Partial<Record<PinType, string | number | boolean>> = {
  number: 3,
  boolean: true,
  string: "склад",
  item: "coal",
  fluid: "water",
  marker: "склад",
  zone: "плавильня",
  target: "склад",
  robot: "АМ-1",
  value: 5,
}

/** Источник данных нужного типа: [вид узла, выход] (действия — тоже до узла по порядку). */
const SOURCES: Partial<Record<PinType, [string, string]>> = {
  entity: ["nearest-entity", "entity"],
  entities: ["entities-near", "entities"],
  robots: ["robots-near", "robots"],
  enemies: ["enemies-near", "enemies"],
  targets: ["markers", "points"],
  list: ["entities-near", "entities"],
  position: ["me-position", "value"],
  message: ["receive", "message"],
  task: ["tasks-next", "task"],
}

describe("каждый узел каталога собирается", () => {
  for (const [kind, spec] of pairs(NODES)) {
    if (SPECIAL.includes(kind)) continue
    test(kind, () => {
      const b = new GraphBuilder()
      const start = b.node("start")
      let last: GraphNode = start
      const node = b.node(kind)
      const pins = resolvePins(node, b.graph)!
      for (const input of pins.inputs) {
        if (input.type === "enemy") {
          const first = b.node("list-first")
          b.data(b.node("enemies-near"), first, "list").data(first, node, input.id)
          continue
        }
        const source = SOURCES[input.type]
        if (source !== undefined) {
          const from = b.node(source[0])
          if (NODES[source[0]].exec) {
            b.exec(last, from)
            last = from
          }
          b.data(from, node, input.id, source[1])
        } else if (!input.optional) {
          node.values[input.id] = INLINE[input.type]
        }
      }
      if (spec.exec) b.exec(last, node)
      else {
        const print = b.node("print")
        b.exec(last, print).data(node, print, "value")
      }
      const result = graphToSource(b.layout(), kind)
      const graphErrors = result.diagnostics.map((d) => `${d.code}@${d.node}${d.pin !== undefined ? `.${d.pin}` : ""}`).join("; ")
      expect(`схема: ${graphErrors}`).toBe("схема: ")
      const compiled = compile(result.source)
      const errors = compiled.ok ? "" : `${compiled.diagnostics.map((d) => `${d.code}(${d.params.join(",")})@${d.line}`).join("; ")}\n${result.source}`
      expect(`код: ${errors}`).toBe("код: ")
    })
  }
})
