**Русский:** [README.md](README.md)

# Automaton

**Factorio without belts.** An overhaul for Factorio 2.0 (base game only): there are no belts, drills, inserters,
logistic robots or offshore pump — their work is done by **automatons**, machines that run your
TypeScript programs. You build the factory from routes and algorithms instead of belts.

![A red and green science factory run by machines](docs/media/factory.gif)

*The factory from the `automaton-science` save: machines mine coal, iron and copper, smelt, carry water
to the boiler, feed the assemblers and labs. Not a single belt.*

```ts
// The "Miner" program: mines coal and carries it to the chest at a marker
const field = scan.resources().find((p) => p.item === "coal")!.nearest
while (true) {
  move(field)
  mine("coal")
  move(marker("depot"), { radius: 2 })
  put(scan.entities({ type: "container" })[0], "coal")
}
```

## Features

- **Language** — a strict subset of TypeScript: classes, interfaces, lambdas, destructuring, `Map`/`Set`,
  `try`/`catch`, type checking on publish. Machine actions simply wait until done — no `async`/`await`.
- **In-game editor** with line numbers and error highlighting, a team program library with versions
  and folders, **publishing from VS Code** when you save a file.
- **Modules**: programs import each other (`import { chestAt } from "./lib/Помощники"`) — your own
  libraries of functions, classes and types; change a library and the programs that depend on it are rebuilt.
- **Assigning programs**: a picker window with search, copying machine settings (Shift+right-click / Shift+left-click),
  a "Programmer" selection box for a dozen machines at once.
- **Machines**: workers Mk1–Mk3, combat machines (machine gun, rockets), flying cargo machines; a charging station.
- **A world for programs**: markers, zones, vision, fluids in the tank, construction, assembler setup.
- **Machines working together**: messages, requests with replies, a shared board, task queues, displays,
  circuit signals.
- **Multiplayer**: everything is deterministic; 300 machines running programs take about 0.6 ms per tick.

| | |
|---|---|
| ![Coal miners](docs/media/miners.gif) | ![Smelting](docs/media/smelting.gif) |
| ![Water carrier at a lake](docs/media/water.gif) | ![Assemblers and labs](docs/media/assembly.gif) |
| ![Flying cargo machines](docs/media/flyers.gif) | ![A guard and biters](docs/media/combat.gif) |

## Installation

1. In the game: "Mods" → search for "Automaton" (once it is published on the mod portal). Or take the
   `automaton_<version>.zip` archive from the [Releases](https://github.com/zawert879/factorio-automanton/releases) page
   (or the one built by `npm run package` in `dist/`) and put it, without unpacking, into the game's `mods` folder:
   Windows `%APPDATA%\Factorio\mods`, macOS `~/Library/Application Support/factorio/mods`, Linux `~/.factorio/mods`.
2. Start a new freeplay game — the starting kit has two automatons and markers; you write the programs
   ([first 15 minutes](docs/en/PLAYER_GUIDE.md#the-first-15-minutes), examples — [examples](examples)).
3. To see a finished factory: type `/am-science` in chat (admin) and it will be built next to you.

## Documentation

| | |
|---|---|
| [Player guide](docs/en/PLAYER_GUIDE.md) | Getting started, the language in five minutes, recipes, progression, debugging |
| [Machine API](docs/API.md) (in Russian) | All functions and objects for programs (with the game in English, the in-game help (F1) and the VS Code types describe them in English) |
| [Language](docs/en/LANGUAGE.md) | What is supported, differences from JavaScript, type checking |
| [VS Code](docs/en/VSCODE.md) | Writing programs in VS Code and publishing on save |
| [Design](docs/DESIGN.md) (in Russian) | Decisions, scale, balance |

## Development

The mod is written in TypeScript (`src/`); TypeScriptToLua builds Lua into `mod/` (linked into the game with a symlink).

| Command | What it does |
|---|---|
| `npm run build` / `npm run watch` | Build the mod |
| `npm test` | Compiler, runtime, type checking, examples from the docs, locale (Lua 5.2, no game) |
| `npm run test:game` | In-game tests (Factorio without a window) |
| `npm run test:desync` / `test:desync:heavy` | Save and load while 50 machines are working |
| `npm run test:mp` | Dedicated server and a client joining mid-work |
| `npm run shot` | Screenshots of the visuals (the game opens a window for a few seconds) |
| `npm run bench:machines` / `bench:flyers` | Load tests |
| `npm run demo:science` | A save with the science factory |
| `npm run docs:record` | Animations for the docs (`docs/media/`) |
| `npm run package` | Mod archive in `dist/` |

More on the checks — [TESTING.md](docs/TESTING.md) (in Russian), the plan — [ROADMAP.md](docs/ROADMAP.md) (in Russian),
releasing (tag → release on GitHub and the mod portal) — [RELEASE.md](docs/RELEASE.md) (in Russian).
