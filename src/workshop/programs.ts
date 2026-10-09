// Новая программа-схема (этап 15): пустая схема со «Стартом», опубликованная под именем из окна программ
// (пустое — «Схема N»). Занятое имя — ошибка, а не новая версия чужой программы.
import { LuaPlayer } from "factorio:runtime"
import { graphToSource } from "../graph/codegen"
import { emptyGraph } from "../graph/model"
import { findProgram, publish, PublishResult } from "../program/store"

export function newGraphProgram(player: LuaPlayer, wanted: string): PublishResult {
  const force = player.force.name
  let name = wanted
  if (name === "") {
    const base = player.locale === "ru" ? "Схема" : "Graph"
    let n = 1
    while (findProgram(`${base} ${n}`, force) !== undefined) n++
    name = `${base} ${n}`
  } else if (findProgram(name, force) !== undefined) {
    return { ok: false, diagnostics: [{ code: "program-name-taken", params: [name], line: 0, column: 0 }] }
  }
  const graph = emptyGraph()
  const source = graphToSource(graph, name, player.locale !== "ru")
  return publish({ name, source: source.source, graph, graphLines: source.lineNodes, author: player.name, force })
}
