// Общее для прогонов в Factorio без окна: сборка мода, временная папка данных и модов, запуск игры.
// Своя папка данных — открытой игре не мешает. mod-list.json создаётся здесь, а не в репозитории
// (несколько таких файлов в workspace ломают запуск отладки FMTK).
import { spawnSync } from "node:child_process"
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export const root = join(fileURLToPath(import.meta.url), "..", "..", "..")
const factorio =
  process.env.FACTORIO_BIN ??
  join(homedir(), "Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio")

export function buildMod() {
  const build = spawnSync("npm", ["run", "build", "--silent"], { cwd: root, stdio: "inherit" })
  if (build.status !== 0) process.exit(build.status ?? 1)
}

/**
 * Временное окружение игры: мод automaton (симлинк на mod/) и служебный мод markerMod,
 * который включает в control.ts нужный тестовый модуль. Карта — без врагов, с фиксированным сидом.
 */
export function prepareWork(name, markerMod, markerVersion = "0.0.1") {
  const work = join(tmpdir(), name)
  const mods = join(work, "mods")
  const data = join(work, "data")
  rmSync(work, { recursive: true, force: true })
  mkdirSync(join(mods, markerMod), { recursive: true })
  mkdirSync(data, { recursive: true })
  symlinkSync(join(root, "mod"), join(mods, "automaton"))
  writeFileSync(
    join(mods, markerMod, "info.json"),
    JSON.stringify({
      name: markerMod,
      version: markerVersion,
      title: markerMod,
      author: "automaton",
      factorio_version: "2.0",
      dependencies: ["automaton"],
    }),
  )
  writeFileSync(
    join(mods, "mod-list.json"),
    JSON.stringify({ mods: ["base", "automaton", markerMod].map((mod) => ({ name: mod, enabled: true })) }),
  )
  writeFileSync(join(work, "config.ini"), `[path]\nread-data=__PATH__system-read-data__\nwrite-data=${data}\n`)
  writeFileSync(
    join(work, "map-gen.json"),
    JSON.stringify({ seed: 1, autoplace_controls: { "enemy-base": { frequency: 0, size: 0, richness: 0 } } }),
  )
  return {
    work,
    data,
    map: join(work, "map.zip"),
    common: ["--config", join(work, "config.ini"), "--mod-directory", mods, "--disable-audio"],
    mapGen: join(work, "map-gen.json"),
  }
}

export function runFactorio(args) {
  const result = spawnSync(factorio, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (result.error) throw result.error
  return result
}

export function createMap(env) {
  return runFactorio([...env.common, "--map-gen-settings", env.mapGen, "--create", env.map])
}

/** Ошибки скриптов Factorio печатает в stdout (в factorio-current.log их нет): блок «Error…» со стеком. */
export function scriptError(output) {
  const lines = output.split("\n")
  const start = lines.findIndex((line) => line.startsWith("Error"))
  if (start < 0) return lines.slice(-20).join("\n")
  const end = lines.findIndex((line, i) => i > start && /^\s+\d+\.\d+ /.test(line))
  return lines.slice(start, end < 0 ? undefined : end).join("\n")
}
