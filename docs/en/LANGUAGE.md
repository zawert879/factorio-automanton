# The automaton program language

A strict subset of TypeScript: every program is valid TypeScript (you can write it in VS Code
with `automaton.d.ts`), but not every TypeScript program is supported. Anything unsupported is a compile
error with a clear message and a line number. The built-in library — [API.md](../API.md) (in Russian; with the
game in English, function descriptions are in English in the in-game help (F1) and in the VS Code types),
the compiler architecture — [DESIGN.md](../DESIGN.md) (in Russian), section «Архитектура исполнения»
(execution architecture).

## What is supported (version 1)

**Values:** `number`, `string`, `boolean`, `null` / `undefined`, arrays, objects, `Map`, `Set`,
functions and closures, class instances, references to game objects (buildings, machines).

**Declarations:** `let`, `const` (block scope), `function`, arrow functions, `class`
(fields, constructor with `readonly` parameters, methods, getters, `static`, `extends` / `super`, `abstract`,
`implements`), `interface`, `type` (used in type checking — see below).

**Statements:** `if` / `else`, `while`, `do … while`, `for (;;)`, `for … of` (arrays, strings, `Map`, `Set`),
`break` / `continue` (including with labels), `return`, `switch` (with fall-through), `throw`,
`try` / `catch` / `finally`, blocks.

**Expressions:** arithmetic (`+ - * / % **`), comparisons (`=== !== < <= > >=`), logic (`&& || !`, with
the operand as the result, as in JS), `??`, `?.`, the ternary operator, assignments (`= += -= *= /= %= **= ??= ||= &&=`),
`++` / `--`, `typeof`, `instanceof`, `in`, template strings, array and object literals (with `...`),
destructuring (in declarations and parameters), default parameters and `...rest`, calls with `...`,
`new`, `this`, `super`, type assertions `as` and `!` (no effect).

**Modules:** `import` / `export` between the team's programs — see [Modules](#modules).

## Representation in Lua

| TypeScript | Lua |
|---|---|
| `number`, `boolean` | number, boolean |
| `string` | Lua string (UTF-8); `length` and indexes are in characters, not bytes |
| `null`, `undefined` | `nil` — **the same thing** (see [Differences](#differences-from-javascript)) |
| array | table `{__a = true, n = length, [1..n] = elements}` — it stores the length, so a `null` inside does not break the array |
| object | table with string keys |
| class instance | table of fields + `__cls = class`; a class is a table `{__m = methods, __g = getters, __s = parent}` |
| function, closure | data `{__f = function number, __e = environment}` |
| `Map`, `Set` | tables with ordered keys (insertion order) |
| building, machine | game object (`LuaEntity`) |

No language value contains Lua functions or metatables, so the whole program state —
variables, frames of paused functions, objects — is kept in `storage` and survives saving.
Compiled code is a cache, rebuilt from the program text on load.

Frequent operations (calls, reading fields and indexes, `+`) are functions of the prologue that the compiler
inserts at the start of every program (`src/lang/prologue.ts`); the rest is the runtime in `src/lang/runtime/`.
A variable captured by a nested function is put into its environment by value if it does not change after
its declaration; otherwise it lives in a cell `{value}` shared by all closures.

## Functions: short and resumable

- **Short** — no loops, no recursion, no action calls, calls only short functions:
  a plain Lua function at full speed. Most lambdas compile this way (`f => f.count(ore) < 10`).
- **Resumable** — all the others: flat code with `goto`, stop points on loop iterations, function
  entries and action calls. A pause (an action, the time quantum ran out) saves the variables into a frame;
  resuming restores them and jumps to the right place.
- A closure called through a value (for example, a lambda in `filter`) is called through the runtime; if it
  is resumable, the resumable version of the array method is used.

## Differences from JavaScript

1. **`null === undefined`** is true: both are `nil`. `typeof null` is `"undefined"`.
2. **`==` and `!=` are not allowed** — only `===` and `!==`.
3. **Numbers** are double-precision, as in JS; division by zero gives infinity, numbers are converted to
   strings as in JS (`0.1 + 0.2` → `0.30000000000000004`, `1e21`, `1e-7`).
4. **Arithmetic and comparison with `undefined`, objects or mixed types is a `TypeError`**, not `NaN`
   and not `false`: `undefined * 2`, `null + 1`, `1 < "2"`. This way you see the error at once. Adding to a string is
   concatenation, as in JS (`"n:" + null` → `"n:undefined"`).
5. **`for (let i …)` with closures**: each iteration gets its own variable, as in JS.
6. **Object key order** (`Object.keys`, `JSON.stringify`, spread) is alphabetical, not insertion
   order (the same for all players). `Map` and `Set` keep insertion order.
7. **`Map.keys()`, `values()`, `entries()`** return arrays, not iterators.
8. **Strings** are UTF-8; length and indexes are in characters (`"дом".length === 3`). `toUpperCase` /
   `toLowerCase` change Latin and Cyrillic letters.
9. **No `undefined` "holes" in arrays**: `[1, , 3]` is an error; `[1, null, 3]` is fine.
10. **Properties on arrays, `Map`s and functions** (except `length`) cannot be set — `TypeError`.

## Modules

A program can import other programs of its team — your own libraries of functions, classes and types.
The path is relative, from the program's folder, without an extension: the program `Logistics/Hauler` writes
`import { nearMarker } from "../lib/Помощники"` (in VS Code this is the same path to the neighbouring file;
`lib/Помощники` is the "Helpers" library from [examples](../../examples)).

```ts
// lib/Помощники
export interface Route { item: Item; keep?: number }
export const FUEL: Item = "coal"
export function chestAt(name: string): Entity | null { … }
export default class Depot { … }
```

```ts
// Logistics/Hauler
import Depot, { chestAt, type Route } from "../lib/Помощники"
import * as H from "../lib/Помощники"
const chest = H.chestAt("depot")
```

- **Import:** `import { a, b as c }`, `import x` (default), `import * as ns` (only `ns.name`, not as
  a value), `import type { T }` and `{ type T }`, `import "./x"` (only run it).
- **Export:** `export` before `function`, `class`, `const` / `let`, `interface`, `type`; `export { a, b as c }`;
  `export default` (a function, a class or an expression); re-export `export { a } from "./x"`, `export * from "./x"`.
- **Execution is as in ES modules:** each module runs once per machine, before the module
  that imports it, in dependency order. Module variables are separate for each machine.
  Imported names are live (they see changes in their module) and read-only.
- **A library** is a module with only declarations at the top level and at least one `export`. It cannot be run
  on a machine: it is there for other programs.
- **Build on publish:** a program is compiled together with all its modules into one piece of code. An error
  in a module is shown with its name: `lib/Помощники:12:5`; runtime error lines look the same.
- **Not allowed:** circular imports, `import(…)`, `require`, `export =`, `export * as ns`, `import` / `export`
  inside a block, a path without `./` or `../`. At most 50 modules and 300,000 bytes of modules per program.

## Not supported

`var`, `async` / `await`, generators, decorators, `enum`, `namespace`,
regular expressions, `Date`, `Symbol`, `BigInt`, `eval`, `with`, `delete`, `label:` on non-loops,
getters/setters in object literals, setters and static getters in classes, `arguments`,
`prototype`, `Function.call/apply/bind`, `extends` from an expression (only from a class name or `Error`),
`super` inside arrow functions, identifiers and properties starting with `__` (reserved by
the runtime).

## Limits (defaults for Mk1; they grow with the model and research)

| Limit | Value | What happens when exceeded |
|---|---|---|
| Instruction quantum per tick | 50 | Pause until the next tick (not an error); operation costs — [API.md, «Время программы»](../API.md#время-программы) (in Russian) |
| Call depth | 200 | Runtime error |
| Objects and arrays in program memory | 10,000 | Runtime error |
| String length | 100,000 characters | Runtime error |
| Program size | 50,000 characters of source | Compile error |

## Errors

- **Compile errors** — a list of `{line, column, text}` in Russian or English (by the player's language).
- **Runtime errors** — an exception; if it is not caught, the machine stops with an error: the text,
  the source line and the program's call stack. Action errors are `ActionError` with a code (API.md).

## Type checking

On publish the game checks types — with the same API description as `automaton.d.ts` for VS Code
(and the description of the built-in library). The check is **gradual**: an error only where it is certain,
and everything unknown (`any`, `JSON.parse`, complex types) is skipped without errors. A program that
`tsc --strict` accepts passes here too.

What is checked:
- properties and methods of known types: `me.cargo.cout(...)` — "property 'cout' does not exist on type Inventory";
- the number of arguments and their types: `wait("5")`, `text(…, { align: "middle" })` (needs `"left" | "center" | "right"`);
- assignments, annotated initial values and `return` against the declared type;
- `let x = 1; x = "a"` — a variable's type is inferred from its value;
- calling a non-function, arithmetic on non-numbers (`"x" * 2`).

Inferred: types of variables, call results (including generic ones: `map`, `reduce`, `find`,
`Map<K, V>`, `receive<T>`), lambda parameters from context (`xs.map(s => s.length)`), classes
and interfaces (structurally). Narrowing: `=== null` / `!== undefined`, `typeof x === "string"`,
`e instanceof ActionError`, a discriminant field (`s.kind === "circle"`), early return
(`if (x === undefined) return`).

Not checked (VS Code will point these out): "possibly `null`/`undefined`", excess properties in object
literals, `readonly`, comparing incompatible types.
