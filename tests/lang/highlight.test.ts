// Тесты подсветки кода для просмотра в редакторе игры (вне игры, Lua 5.2).
import { escapeRichText, highlight, markError, Paint, richLine, Segment } from "../../src/lang/highlight"
import { describe, expect, test } from "../../src/test/testing"

/** Строка как «вид:текст» без пробелов. */
function painted(line: Segment[]): string[] {
  return line.filter((s) => string.match(s.text, "^%s*$")[0] === undefined).map((s) => `${s.paint}:${s.text}`)
}

const COLORS: Record<Paint, string | undefined> = {
  plain: undefined,
  keyword: "k",
  control: "c",
  constant: "n",
  number: "n",
  string: "s",
  comment: "m",
  function: "f",
  type: "t",
  error: "e",
}

describe("подсветка", () => {
  test("ключевые слова, вызовы, свойства, числа, строки", () => {
    expect(painted(highlight(`const n = board.get("ключ") ?? 5`)[0])).toEqual([
      "keyword:const", "plain:n", "plain:=", "plain:board", "plain:.", "function:get", "plain:(", 'string:"ключ"', "plain:)",
      "plain:??", "number:5",
    ])
    expect(painted(highlight("while (true) { if (x) break }")[0])).toEqual([
      "control:while", "plain:(", "constant:true", "plain:)", "plain:{", "control:if", "plain:(", "plain:x", "plain:)",
      "control:break", "plain:}",
    ])
  })

  test("слова по месту: let, of, type, from — ключевые только там, где они ключевые", () => {
    expect(painted(highlight("for (let x of items) print(x)")[0])).toEqual([
      "control:for", "plain:(", "keyword:let", "plain:x", "control:of", "plain:items", "plain:)", "function:print", "plain:(",
      "plain:x", "plain:)",
    ])
    expect(painted(highlight(`import { a } from "./lib"`)[0])[4]).toBe("control:from")
    expect(painted(highlight("const type = 1")[0])[1]).toBe("plain:type")
    expect(painted(highlight("type Point = { x: number }")[0])).toEqual([
      "keyword:type", "type:Point", "plain:=", "plain:{", "plain:x", "plain::", "type:number", "plain:}",
    ])
  })

  test("типы: после class / new / extends и имена с большой буквы; объявление функции", () => {
    expect(painted(highlight("class Bot extends Base {}")[0]).slice(0, 4)).toEqual(["keyword:class", "type:Bot", "keyword:extends", "type:Base"])
    expect(painted(highlight("const m = new Map()")[0])[4]).toBe("type:Map")
    expect(painted(highlight("function go(to: Pos) {}")[0]).slice(0, 2)).toEqual(["keyword:function", "function:go"])
  })

  test("комментарии и строки на несколько строк делятся по строкам", () => {
    const lines = highlight("a /* раз\nдва */ b // три\n`x ${y}\nz`")
    expect(lines.length).toBe(4)
    expect(painted(lines[0])).toEqual(["plain:a", "comment:/* раз"])
    expect(painted(lines[1])).toEqual(["comment:два */", "plain:b", "comment:// три"])
    expect(painted(lines[2])).toEqual(["string:`x ", "plain:${", "plain:y", "plain:}"])
    expect(painted(lines[3])).toEqual(["string:z`"])
  })

  test("строк столько же, сколько в поле ввода; пустые строки и \\r", () => {
    expect(highlight("").length).toBe(1)
    expect(highlight("a\n\nb\n").length).toBe(4)
    expect(painted(highlight("x\r\ny")[0])).toEqual(["plain:x"])
  })

  test("незакрытые строка, шаблон и комментарий не ломают разбор", () => {
    expect(highlight(`print("abc\nnext()`).length).toBe(2)
    expect(painted(highlight("a /* без конца\nтекст")[1])).toEqual(["comment:текст"])
    expect(painted(highlight("`без конца\nтекст")[1])).toEqual(["string:текст"])
  })

  test("ошибка: отрезок под столбцом (в символах), пробел — следующий отрезок", () => {
    const line = highlight("let имя = 1 == 2")[0]
    const marked = painted(markError(line, 13))
    expect(marked[4]).toBe("error:==")
    expect(painted(markError(line, 12))[4]).toBe("error:==")
    expect(painted(markError(line, 40)).filter((s) => s.startsWith("error")).length).toBe(0)
  })

  test("rich text: [ не начинает тег, табуляция — пробелы, обычный текст без тега", () => {
    expect(escapeRichText(`"[color=red]"\tx[1]`)).toBe(`"[[font=automaton-code][/font]color=red]"  x[[font=automaton-code][/font]1]`)
    expect(richLine(highlight(`print("a") // b`)[0], COLORS)).toBe(`[color=f]print[/color]([color=s]"a"[/color]) [color=m]// b[/color]`)
    expect(richLine(highlight("const x")[0], COLORS)).toBe("[color=k]const [/color]x")
  })
})
