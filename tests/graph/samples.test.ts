// Примеры-схемы (src/graph/samples.ts) — те же программы, что examples/*.ts: схема собирается в код,
// код проходит компилятор мода с проверкой типов и исполняется с заглушками API.
import { describe, expect, test } from "../../src/test/testing"
import { compile } from "../../src/lang/codegen"
import { graphToSource } from "../../src/graph/codegen"
import { graphSamples } from "../../src/graph/samples"
import "../lang/api-stubs"

describe("примеры-схемы собираются", () => {
  for (const sample of graphSamples()) {
    test(sample.name, () => {
      const result = graphToSource(sample.graph, sample.name)
      const graphErrors = result.diagnostics.map((d) => `${d.code}@${d.node}${d.pin !== undefined ? `.${d.pin}` : ""}`).join("; ")
      expect(`схема: ${graphErrors}`).toBe("схема: ")
      const compiled = compile(result.source)
      const errors = compiled.ok ? "" : `${compiled.diagnostics.map((d) => `${d.code}(${d.params.join(",")})@${d.line}`).join("; ")}\n${result.source}`
      expect(`код: ${errors}`).toBe("код: ")
    })
  }
})
