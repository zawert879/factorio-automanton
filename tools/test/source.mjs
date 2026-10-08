// Ловушки TypeScriptToLua в коде мода, которые не видны ни tsc, ни тестам на ASCII-строках.
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const TRAPS = [
  {
    // __TS__StringTrim убирает класс байтов [%s ﻿] — съедает конец букв «л», «п», «Р».
    pattern: /\.trim(?:Start|End)?\(\)/,
    message: "s.trim() портит кириллицу (TSTL убирает байты C2 A0 EF BB BF) — trim(s) из src/lang/runtime/strings.ts",
  },
]

function sources(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sources(path, []))
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".generated.ts")) out.push(path)
  }
  return out
}

export function checkSource(root) {
  const problems = []
  for (const file of sources(join(root, "src"))) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
        for (const trap of TRAPS) if (trap.pattern.test(line)) problems.push(`${relative(root, file)}:${i + 1}: ${trap.message}`)
      })
  }
  return problems
}
