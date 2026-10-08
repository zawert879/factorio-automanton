// Управление программами до окна машины (этап 5): команды чата и remote-интерфейс.
// /am-run <машина> <программа>, /am-stop <машина>, /am-log <машина> [строк], /am-args <машина> <json>,
// /am-home <машина> — дом там, где стоит машина. Публикация — remote.call("automaton", "publish", имя, текст).
import { CustomCommandData, LuaPlayer } from "factorio:runtime"
import { lib } from "../lang/runtime/library"
import { assignProgram, machineOf, stopMachine } from "./machines"
import { findProgram, publishProgram } from "./store"

function player(command: CustomCommandData): LuaPlayer | undefined {
  return command.player_index === undefined ? undefined : game.get_player(command.player_index)
}

function words(command: CustomCommandData): string[] {
  return (command.parameter ?? "").split(" ").filter((w) => w !== "")
}

function robotArg(p: LuaPlayer, arg: string | undefined) {
  const robot = storage.robots.byId[tonumber(arg) ?? -1]
  if (robot === undefined || !robot.entity.valid) {
    p.print(["automaton.debug-unknown-robot", arg ?? ""])
    return undefined
  }
  return robot
}

/** Ошибки компиляции одной строкой на ошибку: «[модуль:]строка:столбец код (параметры)». */
export function describeDiagnostics(diagnostics: { code: string; params: (string | number)[]; line: number; column: number; module?: string }[]): string[] {
  return diagnostics.map(
    (d) => `${d.module !== undefined ? `${d.module}:` : ""}${d.line}:${d.column} ${d.code}${d.params.length > 0 ? ` (${d.params.join(", ")})` : ""}`,
  )
}

export function registerProgramCommands(): void {
  commands.add_command("am-run", ["automaton.run-help"], (command) => {
    const p = player(command)
    if (p === undefined) return
    const [id, ...nameParts] = words(command)
    const robot = robotArg(p, id)
    if (robot === undefined) return
    const program = findProgram(nameParts.join(" "))
    if (program === undefined) {
      p.print(["automaton.unknown-program", nameParts.join(" ")])
      return
    }
    if (program.library) {
      p.print(["automaton.library-not-runnable", program.name])
      return
    }
    assignProgram(robot, program)
    p.print(["automaton.program-started", robot.name, program.name, program.version])
  })

  commands.add_command("am-stop", ["automaton.stop-help"], (command) => {
    const p = player(command)
    if (p === undefined) return
    const robot = robotArg(p, words(command)[0])
    if (robot === undefined) return
    stopMachine(machineOf(robot.id))
  })

  commands.add_command("am-log", ["automaton.log-help"], (command) => {
    const p = player(command)
    if (p === undefined) return
    const [id, n] = words(command)
    const robot = robotArg(p, id)
    if (robot === undefined) return
    const record = machineOf(robot.id)
    const count = math.max(1, math.min(100, tonumber(n) ?? 10))
    const lines = record.console.slice(math.max(0, record.console.length - count))
    p.print(`[${robot.name}] ${record.machine.status}`)
    for (const line of lines) p.print(`  ${line}`)
  })

  commands.add_command("am-args", ["automaton.args-help"], (command) => {
    const p = player(command)
    if (p === undefined) return
    const [id, ...json] = words(command)
    const robot = robotArg(p, id)
    if (robot === undefined) return
    const [ok, value] = pcall(lib.JSON.parse, json.join(" "))
    if (!ok) {
      p.print(["automaton.bad-args", tostring((value as { message?: string })?.message ?? value)])
      return
    }
    machineOf(robot.id).args = value
  })

  commands.add_command("am-home", ["automaton.home-help"], (command) => {
    const p = player(command)
    if (p === undefined) return
    const robot = robotArg(p, words(command)[0])
    if (robot === undefined) return
    machineOf(robot.id).home = robot.entity.position
  })

  remote.add_interface("automaton", {
    /** Опубликовать программу: { ok, errors } — ошибки строками «строка:столбец код (…)». */
    publish: (name: string, source: string) => {
      const result = publishProgram(name, source)
      return result.ok ? { ok: true, version: result.program.version } : { ok: false, errors: describeDiagnostics(result.diagnostics) }
    },
    run: (robotId: number, programName: string) => {
      const robot = storage.robots.byId[robotId]
      const program = findProgram(programName)
      if (robot === undefined || program === undefined || program.library) return false
      assignProgram(robot, program)
      return true
    },
    stop: (robotId: number) => stopMachine(machineOf(robotId)),
    console: (robotId: number) => machineOf(robotId).console,
    status: (robotId: number) => machineOf(robotId).machine.status,
  })
}
