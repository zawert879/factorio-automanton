// Внутриигровые тесты: подключаются из control.ts, только когда включён служебный мод automaton-test
// (его создаёт npm run test:game во временной папке модов; в обычной игре его нет).
// Тесты выполняются на первом тике и пишут итог в script-output/automaton-test-results.json.
import { registeredTests } from "./testing"
import "./index"

const RESULTS_FILE = "automaton-test-results.json"

interface TestResult {
  name: string
  ok: boolean
  error?: string
}

function runAll(): void {
  const results: TestResult[] = []
  for (const { name, fn } of registeredTests()) {
    try {
      fn()
      results.push({ name, ok: true })
    } catch (error) {
      results.push({ name, ok: false, error: tostring(error) })
    }
  }
  helpers.write_file(RESULTS_FILE, helpers.table_to_json(results), false)
}

script.on_nth_tick(1, () => {
  script.on_nth_tick(1, undefined)
  runAll()
})
