// npm run demo:science [секунд]: сохранение «automaton-science» — машины по программам делают красную
// и зелёную науку. Карта строится без окна (служебный мод automaton-build-science), игра идёт заданное
// время (по умолчанию 300 с), затем сохранение пересохраняется без служебного мода и кладётся в папку
// сохранений игры: ~/Library/Application Support/factorio/saves/automaton-science.zip.
import { copyFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { buildMod, createMap, prepareWork, root, runFactorio, scriptError } from "../test/factorio.mjs"

const seconds = Number(process.argv[2] ?? 300)
buildMod()
const env = prepareWork("automaton-science-build", "automaton-build-science")
const create = createMap(env)
if (create.status !== 0) throw new Error(scriptError(create.stdout))
const run = runFactorio([...env.common, "--load-game", env.map, "--until-tick", String(seconds * 60)])
if (run.status !== 0) {
  console.error(`игра вышла с кодом ${run.status}:\n${scriptError(run.stdout)}`)
  process.exit(1)
}
const log = readFileSync(join(env.data, "factorio-current.log"), "utf8")
for (const m of log.matchAll(/SCIENCE: (.+)/g)) console.log(m[1])

// Пересохранить без служебного мода: тот же мод automaton, но без automaton-build-science.
const clean = join(tmpdir(), "automaton-science-clean")
rmSync(clean, { recursive: true, force: true })
mkdirSync(join(clean, "mods"), { recursive: true })
mkdirSync(join(clean, "data"), { recursive: true })
symlinkSync(join(root, "mod"), join(clean, "mods", "automaton"))
writeFileSync(join(clean, "mods", "mod-list.json"), JSON.stringify({ mods: ["base", "automaton"].map((name) => ({ name, enabled: true })) }))
writeFileSync(join(clean, "config.ini"), `[path]\nread-data=__PATH__system-read-data__\nwrite-data=${join(clean, "data")}\n`)
const save = join(clean, "automaton-science.zip")
copyFileSync(env.map, save)
const common = ["--config", join(clean, "config.ini"), "--mod-directory", join(clean, "mods"), "--disable-audio"]
const resave = runFactorio([...common, "--load-game", save, "--until-tick", String(seconds * 60 + 60)])
if (resave.status !== 0) {
  console.error(`пересохранение: код ${resave.status}:\n${scriptError(resave.stdout)}`)
  process.exit(1)
}
const target = join(homedir(), "Library", "Application Support", "factorio", "saves", "automaton-science.zip")
copyFileSync(save, target)
console.log(`сохранение: ${target}`)
