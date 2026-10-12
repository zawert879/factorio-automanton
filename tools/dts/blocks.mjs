// Блок кода из docs/API.md — объявления API или программа-пример (19.6: часть разделов — только `interface Me { … }`,
// без declare). Объявления — блок, где на верхнем уровне только declare / interface / type (и комментарии).

/** Блок ```ts — объявления API (а не программа). */
export function isDeclarationBlock(text) {
  if (text.startsWith("type Item")) return true
  let depth = 0
  let inDoc = false
  let declarations = 0
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (inDoc || trimmed.startsWith("/**")) {
      inDoc = !trimmed.endsWith("*/")
      continue
    }
    const bare = line.replace(/\/\/.*$/, "").replace(/"[^"]*"/g, "").trim()
    if (bare === "") continue
    if (depth === 0) {
      if (/^(declare |interface |type )/.test(bare)) declarations++
      else if (!/^[|})\]]/.test(bare)) return false
    }
    depth += (bare.match(/[{([]/g) ?? []).length - (bare.match(/[})\]]/g) ?? []).length
  }
  return declarations > 0
}
