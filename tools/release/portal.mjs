// Выгрузка на портал модов (mods.factorio.com, docs/RELEASE.md). Мода на портале ещё нет — публикация
// (init_publish: архив, описание tools/release/portal.md, категория, лицензия, исходники); есть — новая версия
// (releases/init_upload).
//   FACTORIO_UPLOAD_API_KEY=… node tools/release/portal.mjs dist/automaton_0.3.0.zip
//   node tools/release/portal.mjs dist/automaton_0.3.0.zip --dry-run   — только сказать, что будет сделано
// Ключ — factorio.com/profile, права «ModPortal: Upload Mods» и «ModPortal: Publish Mods».
import { readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(fileURLToPath(import.meta.url), "..", "..", "..")
const API = "https://mods.factorio.com/api"
const CATEGORY = "overhaul"
const LICENSE = "default_mit"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const zipPath = args.find((a) => !a.startsWith("--"))
const key = process.env.FACTORIO_UPLOAD_API_KEY
if (zipPath === undefined || (!dryRun && !key)) {
  console.error("Использование: FACTORIO_UPLOAD_API_KEY=… node tools/release/portal.mjs <архив.zip> [--dry-run]")
  process.exit(2)
}

const info = JSON.parse(readFileSync(join(root, "mod", "info.json"), "utf8"))
const zip = readFileSync(zipPath)

/** Есть ли мод на портале: 200 — есть, 404 — нет, другое — ошибка (не публиковать вслепую). */
async function exists(name) {
  const response = await fetch(`${API}/mods/${encodeURIComponent(name)}`)
  if (response.status === 200) return true
  if (response.status === 404) return false
  throw new Error(`портал ответил ${response.status} на запрос о моде ${name}`)
}

async function post(url, form) {
  const response = await fetch(url, { method: "POST", body: form, headers: { Authorization: `Bearer ${key}` } })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { error: "NotJson", message: text.slice(0, 300) }
  }
  if (!response.ok || body.error !== undefined) throw new Error(`${response.status} ${body.error ?? ""}: ${body.message ?? ""}`)
  return body
}

const known = await exists(info.name)
if (dryRun) {
  console.log(known ? `${info.name} есть на портале — выгрузить версию ${info.version}` : `${info.name} на портале нет — опубликовать (${CATEGORY}, ${LICENSE}, ${info.homepage})`)
  process.exit(0)
}

const init = new FormData()
init.append("mod", info.name)
const { upload_url: uploadUrl } = await post(`${API}/v2/mods/${known ? "releases/init_upload" : "init_publish"}`, init)

const form = new FormData()
form.append("file", new Blob([zip], { type: "application/zip" }), basename(zipPath))
if (!known) {
  form.append("description", readFileSync(join(root, "tools", "release", "portal.md"), "utf8"))
  form.append("category", CATEGORY)
  form.append("license", LICENSE)
  form.append("source_url", info.homepage)
}
await post(uploadUrl, form)
console.log(known ? `Версия ${info.version} выгружена: https://mods.factorio.com/mod/${info.name}` : `Мод опубликован: https://mods.factorio.com/mod/${info.name}`)
