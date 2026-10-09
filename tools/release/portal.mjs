// Выгрузка на портал модов (mods.factorio.com, docs/RELEASE.md) — при каждом выпуске:
// 1. Архив. Мода на портале ещё нет — публикация (init_publish), есть — новая версия (releases/init_upload).
// 2. Страница (18.2). Галерея — GALLERY по порядку (новые картинки загружаются, совпадающие по SHA1 — остаются,
//    остальные убираются; портал перекодирует их в PNG — гифки там без анимации); описание — tools/release/portal.md,
//    картинки в нём (docs/media/…) — с GitHub по тегу выпуска: так гифка в описании анимирована;
//    заголовок, краткое описание (description из mod/info.json), категория, теги, лицензия, ссылки.
//   FACTORIO_UPLOAD_API_KEY=… node tools/release/portal.mjs dist/automaton_0.3.0.zip
//   node tools/release/portal.mjs dist/automaton_0.3.0.zip --dry-run   — только сказать, что будет сделано
// Ключ — factorio.com/profile, права «ModPortal: Upload Mods», «ModPortal: Publish Mods» и «ModPortal: Edit Mods».
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(fileURLToPath(import.meta.url), "..", "..", "..")
const API = "https://mods.factorio.com/api"
const CATEGORY = "overhaul"
const LICENSE = "default_mit"
const TAGS = ["logistics", "mining", "manufacturing", "combat", "circuit-network"]
/** Галерея на странице мода — в этом порядке (пути от корня репозитория). */
const GALLERY = [
  "docs/media/factory.gif",
  "docs/media/miners.gif",
  "docs/media/smelting.gif",
  "docs/media/assembly.gif",
  "docs/media/water.gif",
  "docs/media/flyers.gif",
  "docs/media/combat.gif",
  "docs/media/display.gif",
  "docs/media/editor.gif",
  "docs/media/machine-window.png",
  "docs/media/picker.png",
]
const MIME = { gif: "image/gif", png: "image/png", jpg: "image/jpeg" }

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

/** Сведения о моде на портале (с галереей); мода нет — undefined; другой ответ — ошибка (не публиковать вслепую). */
async function portalMod(name) {
  const response = await fetch(`${API}/mods/${encodeURIComponent(name)}/full`)
  if (response.status === 200) return response.json()
  if (response.status === 404) return undefined
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
  if (!response.ok || body.error !== undefined) {
    const error = new Error(`${response.status} ${body.error ?? ""}: ${body.message ?? ""}`)
    error.code = body.error
    throw error
  }
  return body
}

function modForm(fields) {
  const form = new FormData()
  form.append("mod", info.name)
  for (const [name, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) form.append(name, item)
  }
  return form
}

const sha1 = (data) => createHash("sha1").update(data).digest("hex")

/** Архив: публикация нового мода или новая версия (эта версия уже есть — пропустить: перезапуск workflow). */
async function uploadRelease(mod) {
  if (mod?.releases?.some((r) => r.version === info.version)) {
    console.log(`Версия ${info.version} уже на портале`)
    return
  }
  const known = mod !== undefined
  const { upload_url: uploadUrl } = await post(`${API}/v2/mods/${known ? "releases/init_upload" : "init_publish"}`, modForm({}))
  const form = new FormData()
  form.append("file", new Blob([zip], { type: "application/zip" }), basename(zipPath))
  if (!known) {
    form.append("category", CATEGORY)
    form.append("license", LICENSE)
    form.append("source_url", info.homepage)
  }
  await post(uploadUrl, form)
  console.log(known ? `Версия ${info.version} выгружена` : `Мод опубликован: https://mods.factorio.com/mod/${info.name}`)
}

/** Галерея по порядку GALLERY (не принятые порталом картинки — пропускаются с предупреждением). */
async function syncGallery(existing) {
  const ids = []
  for (const path of GALLERY) {
    const data = readFileSync(join(root, path))
    const id = sha1(data)
    let image = existing.find((i) => i.id === id)
    if (image === undefined) {
      try {
        const { upload_url: uploadUrl } = await post(`${API}/v2/mods/images/add`, modForm({}))
        const form = new FormData()
        form.append("image", new Blob([data], { type: MIME[path.split(".").pop()] }), basename(path))
        image = await post(uploadUrl, form)
        console.log(`картинка загружена: ${path}`)
      } catch (error) {
        if (error.code !== "InvalidImageUpload") throw error
        console.log(`::warning::портал не принял картинку ${path}: ${error.message}`)
        continue
      }
    }
    ids.push(image.id)
  }
  await post(`${API}/v2/mods/images/edit`, modForm({ images: ids.join(",") }))
  console.log(`галерея: ${ids.length} из ${GALLERY.length}`)
}

/** Картинка из репозитория по тегу выпуска (raw.githubusercontent.com; портал показывает внешние картинки). */
function repositoryUrl(path) {
  const repo = info.homepage.replace(/^https:\/\/github\.com\//, "")
  return `https://raw.githubusercontent.com/${repo}/v${info.version}/${path}`
}

/** Описание: картинки docs/media/… — с GitHub по тегу выпуска. */
function description() {
  const text = readFileSync(join(root, "tools", "release", "portal.md"), "utf8")
  return text.replace(/\]\((docs\/media\/[^)]+)\)/g, (_, path) => `](${repositoryUrl(path)})`)
}

async function updatePage() {
  await post(
    `${API}/v2/mods/edit_details`,
    modForm({
      title: info.title,
      summary: info.description,
      description: description(),
      category: CATEGORY,
      tags: TAGS,
      license: LICENSE,
      homepage: info.homepage,
      source_url: info.homepage,
    }),
  )
  console.log(`страница обновлена: https://mods.factorio.com/mod/${info.name}`)
}

const mod = await portalMod(info.name)
if (dryRun) {
  const released = mod?.releases?.some((r) => r.version === info.version)
  console.log(mod === undefined ? `${info.name} на портале нет — опубликовать` : released ? `версия ${info.version} уже на портале` : `выгрузить версию ${info.version}`)
  const existing = mod?.images ?? []
  const fresh = GALLERY.filter((path) => !existing.some((i) => i.id === sha1(readFileSync(join(root, path)))))
  console.log(`галерея: ${GALLERY.length} картинок, загрузить ${fresh.length}; теги: ${TAGS.join(", ")}`)
  const preview = description()
  console.log(`описание: ${preview.length} символов, начало:\n${preview.split("\n").slice(0, 3).join("\n")}`)
  process.exit(0)
}

await uploadRelease(mod)
await syncGallery((await portalMod(info.name))?.images ?? [])
await updatePage()
