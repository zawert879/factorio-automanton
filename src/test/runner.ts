// Внутриигровые тесты: подключаются из control.ts, только когда включён служебный мод automaton-test
// (его создаёт npm run test:game во временной папке модов; в обычной игре его нет).
// Тесты идут по очереди; t.after(тики, fn) продолжает тест позже. Итог —
// script-output/automaton-test-results.json, как только все тесты закончатся или выйдет время.
import { TECH } from "../names"
import { registeredTests, TestCase, TestContext } from "./testing"
import "./index"

/**
 * Исследования, которые открывают функции API (8.4): тестам API они нужны. Сенсоры и улучшения не
 * исследуются — они меняют характеристики машин (их тесты исследуют сами и откатывают).
 */
const TEST_RESEARCH = [TECH.radio, TECH.display, TECH.tuning, TECH.fluids, TECH.construction, TECH.circuits, TECH.combat1]
let prepared = false

const RESULTS_FILE = "automaton-test-results.json"
/** Последний тик, до которого тесты обязаны закончиться (npm run test:game гоняет игру дольше). */
const DEADLINE_TICK = 20000

interface TestResult {
  name: string
  ok: boolean
  error?: string
}

interface Step {
  atTick: number
  fn: (this: void) => void
}

const queue: TestCase[] = [...registeredTests()]
const results: TestResult[] = []
let current: { name: string; steps: Step[]; failed: boolean } | undefined

function attempt(fn: (this: void) => void): void {
  try {
    fn()
  } catch (error) {
    current!.failed = true
    current!.steps = []
    results.push({ name: current!.name, ok: false, error: tostring(error) })
  }
}

function finishCurrent(): void {
  if (!current!.failed) results.push({ name: current!.name, ok: true })
  current = undefined
}

function startNext(): void {
  const test = queue.shift()!
  const state = { name: test.name, steps: [] as Step[], failed: false }
  current = state
  const t: TestContext = {
    // От текущего тика: after() вызывают и из шагов, выполняющихся позже начала теста.
    after: (ticks, fn) => {
      state.steps.push({ atTick: game.tick + ticks, fn })
    },
  }
  attempt(() => test.fn(t))
}

function writeResults(): void {
  helpers.write_file(RESULTS_FILE, helpers.table_to_json(results), false)
  script.on_nth_tick(1, undefined)
}

script.on_nth_tick(1, (event) => {
  const tick = event.tick
  if (!prepared) {
    prepared = true
    for (const tech of TEST_RESEARCH) game.forces.player.technologies[tech].researched = true
  }
  if (tick > DEADLINE_TICK) {
    if (current !== undefined) results.push({ name: current.name, ok: false, error: `не закончился к тику ${DEADLINE_TICK}` })
    for (const test of queue) results.push({ name: test.name, ok: false, error: "не запускался: вышло время" })
    writeResults()
    return
  }
  // За один тик: выполнить созревшие шаги текущего теста или начать следующие тесты.
  while (true) {
    if (current !== undefined) {
      const due = current.steps.filter((step) => step.atTick <= tick)
      if (due.length > 0) {
        current.steps = current.steps.filter((step) => step.atTick > tick)
        for (const step of due) {
          if (current.failed) break
          attempt(step.fn)
        }
      }
      if (current.steps.length > 0) return
      finishCurrent()
    }
    if (queue.length === 0) {
      writeResults()
      return
    }
    startNext()
  }
})
