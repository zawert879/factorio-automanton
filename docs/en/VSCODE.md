# Writing programs in VS Code

Writing programs in VS Code is more comfortable than in the game editor: highlighting, API function hints,
documentation on hover, errors before you publish. Save the file — the program is published in the game.

## Once

1. Install [Node.js](https://nodejs.org) 18 or newer (the sync tool needs it; on Linux, programs in
   subfolders need 20 or newer).
2. Game launch option: `--enable-lua-udp 27155`. In Steam: Factorio → Properties → Launch Options.
   This is how the mod receives programs from VS Code (both in single player and in multiplayer).
3. In the game: machine window → "Programs…" → **"Folder for VS Code"**. The mod writes everything needed
   to `script-output/automaton/<map>/<team>/` in the game's data folder (each map has its own folder; the map
   name is `карта-<map number>`, "карта" is Russian for "map"):
   - the team's programs — in the `src` folder (`src/Miner.ts`, `src/lib/Помощники.ts` and so on),
   - `automaton.d.ts` — the API types, `tsconfig.json`,
   - `automaton-sync.mjs` — the sync tool,
   - `.vscode/tasks.json` — a task that starts the tool when the folder is opened,
   - `.automaton-map.json` — which map this folder belongs to,
   - a TypeScript plugin (`.automaton/`) and `.vscode/settings.json`, which enables it.

   The game's data folder: Windows — `%APPDATA%\Factorio`, macOS — `~/Library/Application Support/factorio`,
   Linux — `~/.factorio`.
4. Open this folder in VS Code (File → Open Folder) and allow the automatic task
   "Automaton: публиковать при сохранении" ("publish on save").

## Every day

- **The `src` folder mirrors the team's programs both ways.** Save a file — the program is published and
  the machines running it are restarted; delete a file — the program is deleted in the game; rename or move a file —
  the program is renamed (imports in other programs are fixed). And the other way: publish, delete
  or rename a program in the game (or a teammate does it) — the files in `src` change the same way.
  The program name is the file's path in `src` without `.ts`: `src/lib/Помощники.ts` is the program `lib/Помощники`
  (the "Helpers" library from [examples](../../examples)) — or the first line `// @program Name`.
- **Modules:** programs import each other like ordinary TypeScript files —
  `import { nearMarker } from "../lib/Помощники"` (details — [LANGUAGE.md, "Modules"](LANGUAGE.md#modules)).
  Hints, go to definition and rename with import updates work as in any project.
- Save a library — the game rebuilds the programs that import it. If one of them does not build
  with the new version, its errors appear in its file (in the game it keeps running the previous build).
- Errors found by the game are underlined right in the code (like TypeScript errors).
- Programs your teammates published in the game: `node automaton-sync.mjs pull` in the VS Code terminal.
- A folder can hold any number of programs: each file is a separate program (the same
  names in different files do not clash — `moduleDetection: "force"` in `tsconfig.json`).
- **A folder belongs to one map.** If a different map is open in the game, the tool publishes nothing and says
  that this folder is for map …, but the game has … open: open that map's folder ("Folder for VS Code" in that map).
- **Plugin hints and errors** (only for files in `src` of this folder): things the machine language lacks
  (`async`/`await`, `var`, `enum`, regular expressions, `==` …) are underlined as errors before you publish.
  Hover over `for` / `while` to see the cost of one iteration and how many ticks the loop takes (if the number
  of iterations is visible from the code); such loops show a suggestion ("…"). On `publish`, `sort`, `map`,
  `JSON.parse` — their cost. If the plugin does not work right away — "TypeScript: Restart TS Server" in the
  Command Palette (Cmd/Ctrl+Shift+P); VS Code must trust the folder.
- **"Refresh from folder"** in the programs window — if you changed files while the sync task was not running:
  the tool publishes new and changed files, and the game lists its programs that have no file and asks
  whether to delete them. On start the tool itself reports how `src` differs from the game.
- The tool updates itself: when "Folder for VS Code" writes a new version, the task restarts.
  A tool of a different version than the mod is refused, with a hint on what to do.
- A library that is in use cannot be deleted, neither in the game nor by deleting its file: the file goes away, but
  the library stays in the game, and the programs that import it get an error: they import a library whose file
  was deleted.
- If your folder is of the old kind (programs right in it, no `src`), press "Folder for VS Code" again:
  the programs appear in `src`; the old program files in the folder root can be deleted, the tool no longer looks at them.

## Dedicated server

On a dedicated server (`--start-server`) UDP does not work (Factorio 2.0.77 crashes), so RCON is used there:
the server is started with `--rcon-port 27015 --rcon-password …`, and the tool with
`node automaton-sync.mjs watch . --rcon --port 27015 --password …` (the password can go in the
`AUTOMATON_RCON_PASSWORD` variable or in `.automaton-sync.json`: `{ "rcon": true, "port": 27015, "password": "…" }`).

## Good to know

- If the game shows errors that VS Code did not, these are TypeScript features the machine language
  does not have (the list — [LANGUAGE.md, "Not supported"](LANGUAGE.md#not-supported)): `var`, `async`, regular expressions,
  `enum` and so on. The error text tells you what to use instead.
- The game also checks types when publishing, but less strictly than VS Code: only where the error is certain (no
  such property, wrong argument, wrong number of arguments). The game does not check "possibly null" — VS Code
  will point that out.
- `null` and `undefined` are the same thing in the machine language, and `==` is not allowed: write `===`.
- Actions (`move`, `mine`, `put`…) simply wait until they finish — no `async`/`await`.
- API reference — [API.md](../API.md) (in Russian; with the game in English, function descriptions are in English
  in the in-game help (F1) and in the VS Code types), language reference — [LANGUAGE.md](LANGUAGE.md).
