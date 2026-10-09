// Заметки к выпуску на GitHub из mod/changelog.txt: раздел версии → Markdown (категории — заголовки,
// пункты — список). node tools/release/notes.mjs 0.3.0 > notes.md
// Нет раздела этой версии — ошибка: выпуск без changelog не делается (его же показывает игра в «Моды»).
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(fileURLToPath(import.meta.url), "..", "..", "..")
const version = process.argv[2]
if (!version) {
  console.error("Использование: node tools/release/notes.mjs <версия>")
  process.exit(2)
}

const sections = readFileSync(join(root, "mod", "changelog.txt"), "utf8").split(/^-{99}\r?\n/m)
const section = sections.find((s) => s.match(/^Version: (.+)$/m)?.[1].trim() === version)
if (section === undefined) {
  console.error(`В mod/changelog.txt нет раздела «Version: ${version}»`)
  process.exit(1)
}

const out = []
for (const line of section.split(/\r?\n/)) {
  let m
  if ((m = line.match(/^ {2}(\S.*):$/))) out.push("", `### ${m[1]}`)
  else if ((m = line.match(/^ {4}- (.*)$/))) out.push(`- ${m[1]}`)
  // Продолжение пункта на следующей строке (отступ 6).
  else if ((m = line.match(/^ {6}(\S.*)$/)) && out.length > 0) out[out.length - 1] += ` ${m[1]}`
}
console.log(out.join("\n").trim())
