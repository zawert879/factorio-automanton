// npm run names — словарь имён (24.1): какие здания (по классам программ), предметы и жидкости есть в игре с модом.
// Запускает Factorio без окна со служебным модом automaton-names (src/test/namesDump.ts выгружает прототипы),
// названия берёт из локалей игры и мода (ru, en) и пишет:
//   tools/names/names.json — данные для подсказок VS Code и поиска в справке (tools/dts/generate.mjs);
//   docs/NAMES.md, docs/en/NAMES.md — словарь для чтения.
// Только базовая игра: в справке F1 (раздел «Имена») список строится в игре и включает другие моды.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { buildMod, createMap, prepareWork, root, runFactorio, scriptError } from "../test/factorio.mjs"

const factorio = process.env.FACTORIO_BIN ?? join(homedir(), "Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio")
const gameData = join(factorio, "..", "..", "data")

buildMod()
const env = prepareWork("automaton-names-dump", "automaton-names")
const create = createMap(env)
const run = create.status === 0 ? runFactorio([...env.common, "--benchmark", env.map, "--benchmark-ticks", "5"]) : create
const dumpFile = join(env.data, "script-output", "automaton-names.json")
if (!existsSync(dumpFile)) {
  console.error(`Игра не выгрузила имена (код ${run.status}):\n${scriptError(run.stdout)}`)
  process.exit(1)
}
const dump = JSON.parse(readFileSync(dumpFile, "utf8"))

/** Локаль: «раздел.ключ» → текст, из всех .cfg папки. */
function readLocale(dirs) {
  const result = new Map()
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".cfg"))) {
      let section = ""
      for (const raw of readFileSync(join(dir, file), "utf8").split("\n")) {
        const line = raw.trim()
        if (line.startsWith("[") && line.endsWith("]")) section = line.slice(1, -1)
        else if (line.includes("=") && !line.startsWith(";") && !line.startsWith("#")) {
          const at = line.indexOf("=")
          result.set(`${section}.${line.slice(0, at)}`, line.slice(at + 1))
        }
      }
    }
  }
  return result
}

const locales = {
  ru: readLocale([join(gameData, "base", "locale", "ru"), join(gameData, "core", "locale", "ru"), join(root, "mod", "locale", "ru")]),
  en: readLocale([join(gameData, "base", "locale", "en"), join(gameData, "core", "locale", "en"), join(root, "mod", "locale", "en")]),
}

/** Текст ключа со ссылками __ENTITY__x__ / __ITEM__x__ / __FLUID__x__ (как их раскрывает игра). */
function text(lang, key, depth = 0) {
  const value = locales[lang].get(key)
  if (value === undefined || depth > 5) return value
  return value.replace(/__(ENTITY|ITEM|FLUID|TILE)__([a-z0-9-]+)__/g, (_, kind, name) => text(lang, `${kind.toLowerCase()}-name.${name}`, depth + 1) ?? name)
}
const firstText = (lang, keys, fallback) => keys.map((k) => text(lang, k)).find((t) => t !== undefined && t !== "") ?? fallback

const itemByName = new Map(dump.items.map((i) => [i.name, i]))
const groupOrder = new Map(dump.groups.map((g) => [g.name, g.order]))
const sortKey = (item) => (item === undefined ? "~" : `${groupOrder.get(item.group) ?? item.groupOrder}|${item.subgroupOrder}|${item.order}|${item.name}`)

/** Классы зданий — в порядке API.md («Классы зданий»), здания без своего класса — в конце. */
const CLASSES = ["Chest", "Furnace", "Assembler", "RocketSilo", "Lab", "Beacon", "Boiler", "Generator", "Reactor", "StorageTank", "Pipe", "Turret", "FlameTurret", "CargoWagon", "FluidWagon", "Locomotive", "Vehicle", "ChargingStation", "Building"]

const names = {
  version: dump.version,
  buildings: dump.buildings
    .map((b) => ({
      name: b.name,
      class: b.class,
      ru: firstText("ru", [`entity-name.${b.name}`, `item-name.${b.item}`], b.name),
      en: firstText("en", [`entity-name.${b.name}`, `item-name.${b.item}`], b.name),
      key: sortKey(itemByName.get(b.item)),
    }))
    .sort((a, b) => CLASSES.indexOf(a.class) - CLASSES.indexOf(b.class) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ key, ...rest }) => rest),
  items: dump.items
    .map((i) => ({
      name: i.name,
      group: i.group,
      ru: firstText("ru", [`item-name.${i.name}`, ...(i.places ? [`entity-name.${i.places}`] : []), `equipment-name.${i.name}`], i.name),
      en: firstText("en", [`item-name.${i.name}`, ...(i.places ? [`entity-name.${i.places}`] : []), `equipment-name.${i.name}`], i.name),
      key: sortKey(i),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ key, ...rest }) => rest),
  fluids: dump.fluids
    .sort((a, b) => (a.order < b.order ? -1 : 1))
    .map((f) => ({ name: f.name, ru: firstText("ru", [`fluid-name.${f.name}`], f.name), en: firstText("en", [`fluid-name.${f.name}`], f.name) })),
  groups: dump.groups
    .sort((a, b) => (a.order < b.order ? -1 : 1))
    .map((g) => ({ name: g.name, ru: firstText("ru", [`item-group-name.${g.name}`], g.name), en: firstText("en", [`item-group-name.${g.name}`], g.name) })),
}
writeFileSync(join(root, "tools", "names", "names.json"), JSON.stringify(names, null, 1) + "\n")

// ---------- docs/NAMES.md, docs/en/NAMES.md ----------
const TEXT = {
  ru: {
    title: "Словарь имён",
    intro: (version) =>
      `Имена, которые пишут программы: здания для поиска (\`zone("плавильня").find("stone-furnace")\`, ` +
      "`scan.buildings({ name: … })`), предметы (`chest.extract(\"iron-plate\")`, `me.mine(\"coal\")`) и жидкости " +
      `(\`me.tank.pump("water")\`). Factorio 2.0, только base, мод Automaton ${version} — то, что мод убрал из игры, здесь ` +
      "не показано. В игре тот же словарь — справка F1, раздел «Имена» (там и имена других модов); VS Code подсказывает " +
      "имена при наборе. Страница создаётся командой `npm run names`.",
    buildings: "Здания",
    buildingsIntro: "По классам программ: `zone(…).find(Furnace)` находит все здания класса, `find(\"stone-furnace\")` — по имени.",
    other: "здания без своего класса (у них есть только общее у всех зданий)",
    items: "Предметы",
    fluids: "Жидкости",
    building: "Здание",
    item: "Предмет",
    fluid: "Жидкость",
    name: "Имя",
  },
  en: {
    title: "Names",
    intro: (version) =>
      `The names programs use: buildings to search for (\`zone("smelter").find("stone-furnace")\`, ` +
      "`scan.buildings({ name: … })`), items (`chest.extract(\"iron-plate\")`, `me.mine(\"coal\")`) and fluids " +
      `(\`me.tank.pump("water")\`). Factorio 2.0, base game only, Automaton ${version} — what the mod removes from the game ` +
      "is not listed. In the game, the same list is in the help (F1), section Names (with names from other mods too); " +
      "VS Code suggests the names as you type. This page is made by `npm run names`.",
    buildings: "Buildings",
    buildingsIntro: "By program class: `zone(…).find(Furnace)` finds every building of the class, `find(\"stone-furnace\")` — by name.",
    other: "buildings without a class of their own (they only have what every building has)",
    items: "Items",
    fluids: "Fluids",
    building: "Building",
    item: "Item",
    fluid: "Fluid",
    name: "Name",
  },
}

function page(lang) {
  const t = TEXT[lang]
  const lines = [`# ${t.title}`, "", t.intro(names.version), "", `## ${t.buildings}`, "", t.buildingsIntro, ""]
  for (const cls of CLASSES) {
    const list = names.buildings.filter((b) => b.class === cls)
    if (list.length === 0) continue
    lines.push(`### ${cls}${cls === "Building" ? ` — ${t.other}` : ""}`, "", `| ${t.building} | ${t.name} |`, "|---|---|")
    for (const b of list) lines.push(`| ${b[lang]} | \`${b.name}\` |`)
    lines.push("")
  }
  lines.push(`## ${t.items}`, "")
  for (const group of names.groups) {
    const list = names.items.filter((i) => i.group === group.name)
    if (list.length === 0) continue
    lines.push(`### ${group[lang]}`, "", `| ${t.item} | ${t.name} |`, "|---|---|")
    for (const i of list) lines.push(`| ${i[lang]} | \`${i.name}\` |`)
    lines.push("")
  }
  lines.push(`## ${t.fluids}`, "", `| ${t.fluid} | ${t.name} |`, "|---|---|")
  for (const f of names.fluids) lines.push(`| ${f[lang]} | \`${f.name}\` |`)
  lines.push("")
  return lines.join("\n")
}
writeFileSync(join(root, "docs", "NAMES.md"), page("ru"))
writeFileSync(join(root, "docs", "en", "NAMES.md"), page("en"))
console.log(`Имена: зданий ${names.buildings.length}, предметов ${names.items.length}, жидкостей ${names.fluids.length} — tools/names/names.json, docs/NAMES.md, docs/en/NAMES.md`)
