// npm run test:desync: сохранение и загрузка посреди работы не должны менять ход игры.
// Прогон A — DUMP_TICK тиков подряд; прогон B — SAVE_TICK тиков, сохранение, загрузка, доигрывание.
// В обоих на тике DUMP_TICK мод пишет снимок storage (src/test/stateDump.ts) — снимки должны совпасть.
// Ловит состояние вне storage (локальные переменные, кэши), изменения storage в on_load и т.п.
import { copyFileSync, existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { buildMod, createMap, prepareWork, runFactorio, scriptError } from "./factorio.mjs"

const SAVE_TICK = 300
const DUMP_TICK = 600 // как в src/test/stateDump.ts

buildMod()
const env = prepareWork("automaton-test-desync", "automaton-desync-test")
const dumpFile = join(env.data, "script-output", "automaton-state.txt")

function fail(message) {
  console.error(message)
  process.exit(1)
}

function check(result, what) {
  if (result.status !== 0) fail(`${what}: игра завершилась с кодом ${result.status}\n${scriptError(result.stdout)}`)
}

// --load-game + --until-tick: без окна, в ускоренном режиме; по достижении тика игра сохраняется и выходит.
function runUntil(save, tick, what) {
  check(runFactorio([...env.common, "--load-game", save, "--until-tick", String(tick)]), what)
}

function takeDump(what) {
  if (!existsSync(dumpFile)) fail(`${what}: снимок состояния не записан`)
  const dump = readFileSync(dumpFile, "utf8")
  rmSync(dumpFile)
  return dump
}

check(createMap(env), "создание карты")

const a = join(env.work, "a.zip")
copyFileSync(env.map, a)
runUntil(a, DUMP_TICK + 1, "прогон A")
const dumpA = takeDump("прогон A")

const b = join(env.work, "b.zip")
copyFileSync(env.map, b)
runUntil(b, SAVE_TICK, "прогон B до сохранения")
runUntil(b, DUMP_TICK + 1, "прогон B после загрузки")
const dumpB = takeDump("прогон B")

if (dumpA === dumpB) {
  console.log(`сохранение на тике ${SAVE_TICK} не изменило состояние на тике ${DUMP_TICK} — ок`)
  process.exit(0)
}

const linesA = dumpA.split("\n")
const linesB = dumpB.split("\n")
const diff = linesA
  .map((line, i) => (line === linesB[i] ? null : `  без сохранения:  ${line}\n  с сохранением:   ${linesB[i] ?? "<нет строки>"}`))
  .filter((line) => line !== null)
fail(`ДЕСИНК: после сохранения на тике ${SAVE_TICK} состояние на тике ${DUMP_TICK} другое:\n${diff.slice(0, 20).join("\n")}`)
