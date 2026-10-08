// Проверка: файлы игры, на которые ссылаются прототипы мода (__base__/…, __core__/…), существуют.
// Тесты без окна графику не загружают — неверный путь всплыл бы только у игрока при запуске игры.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export function checkAssets(root) {
  const data = join(process.env.HOME, "Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/data")
  if (!existsSync(data)) return { checked: 0, missing: [] }
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith(".ts")) files.push(path)
    }
  }
  walk(join(root, "src"))
  const paths = new Set()
  for (const file of files) {
    const text = readFileSync(file, "utf8")
    for (const m of text.matchAll(/["`](__(base|core)__\/[^"`$]+\.(png|ogg))["`]/g)) paths.add(m[1])
    // Сокращение ICON + "имя.png" в технологиях — значки base.
    for (const m of text.matchAll(/ICON \+ "([^"]+\.png)"/g)) paths.add(`__base__/graphics/icons/${m[1]}`)
  }
  const missing = [...paths].filter((p) => !existsSync(join(data, p.replace(/^__(base|core)__/, "$1"))))
  return { checked: paths.size, missing }
}
