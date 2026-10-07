// Мини-библиотека тестов: describe / test / expect.
// Общая для тестов вне игры (tests/, Lua 5.2) и внутриигровых (src/test/, npm run test:game).

export interface TestCase {
  name: string
  fn: () => void
}

const cases: TestCase[] = []
const scope: string[] = []

export function describe(name: string, body: () => void): void {
  scope.push(name)
  try {
    body()
  } finally {
    scope.pop()
  }
}

export function test(name: string, fn: () => void): void {
  cases.push({ name: [...scope, name].join(" › "), fn })
}

export function registeredTests(): readonly TestCase[] {
  return cases
}

function fail(message: string): never {
  throw new Error(message)
}

function show(value: unknown): string {
  if (typeof value === "string") return `"${value}"`
  if (typeof value !== "object" || value === null) return tostring(value)
  const table = value as Record<string, unknown>
  const keys = Object.keys(table).sort((a, b) => (tostring(a) < tostring(b) ? -1 : 1))
  return "{" + keys.map((k) => `${k}: ${show(table[k])}`).join(", ") + "}"
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  const ta = a as Record<string, unknown>
  const tb = b as Record<string, unknown>
  const keysA = Object.keys(ta)
  if (keysA.length !== Object.keys(tb).length) return false
  return keysA.every((k) => deepEqual(ta[k], tb[k]))
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return tostring((error as { message: unknown }).message)
  }
  return tostring(error)
}

export function expect<T>(actual: T) {
  return {
    toBe(expected: T): void {
      if (actual !== expected) fail(`ожидалось ${show(expected)}, получено ${show(actual)}`)
    },
    toEqual(expected: T): void {
      if (!deepEqual(actual, expected)) fail(`ожидалось ${show(expected)}, получено ${show(actual)}`)
    },
    toBeTruthy(): void {
      if (!actual) fail(`ожидалось истинное значение, получено ${show(actual)}`)
    },
    toThrow(messagePart?: string): void {
      try {
        ;(actual as unknown as () => void)()
      } catch (error) {
        const message = errorMessage(error)
        if (messagePart !== undefined && !message.includes(messagePart)) {
          fail(`ожидалась ошибка с «${messagePart}», получена «${message}»`)
        }
        return
      }
      fail("ожидалась ошибка, но её не было")
    },
  }
}
