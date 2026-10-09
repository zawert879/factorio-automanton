![A red and green science factory run entirely by automatons — no belts, no inserters](docs/media/factory.gif)

**Automaton** is an overhaul for playing with friends: belts, drills, inserters, logistic robots and the offshore pump are gone. Their work is done by **automatons** — machines that run programs you write in a subset of **TypeScript**, right in the game or in VS Code.

```ts
// Mine coal and carry it to the chest at the "depot" marker.
const field = scan.resources().find((p) => p.item === "coal")!.nearest
while (true) {
  move(field)
  mine("coal")
  move(marker("depot"), { radius: 2 })
  put(scan.entities({ type: "container" })[0], "coal")
}
```

## What's inside

- **Programmable machines.** Programs are compiled in the game and shared by the whole team; publishing a new version restarts the machines that run it. Errors are shown with line numbers, types are checked on publish.
- **Editor in the game** with syntax highlighting, a check without publishing, in-game help (F1), a debugger with breakpoints and variables, and **VS Code integration**: autocompletion, documentation on hover, publishing on save, a separate program folder per save.
- **Sharing**: programs as a string (like blueprint strings); blueprints keep the machines' programs and parameters.
- **Modules**: `import` / `export` between team programs, your own libraries, folders.
- **Everything automatons do**: mining, smelting, crafting, fluids (pumping, crude oil, uranium), building and deconstructing, messaging by subscription, a shared board and task queues, pixel displays, circuit network signals.
- **Combat automatons** (machine gun, rocket launcher) — biters attack your machines and routes — and **flying haulers**.
- **Progression**: worker models Mk1–Mk3, charging stations, research that unlocks API features and more processor time.
- **You write the programs**: freeplay starts with two automatons and markers and an empty team library; the player guide walks you through your first program, and the repository has examples (miner, smelter, hauler, water carrier…).
- **Scales**: 10 000 machines with programs run at 60 UPS.

## Getting started

Start a new freeplay game: you get two automatons and markers. Click a machine, press "Programs…" → "New", write a program (or paste one from the guide), publish it, assign it to the machine and press Run. **Press F1** in the game for help on every function, with examples.

- [Player guide](https://github.com/zawert879/factorio-automanton/blob/main/docs/en/PLAYER_GUIDE.md) — first steps, recipes, progression, debugging
- [Writing programs in VS Code](https://github.com/zawert879/factorio-automanton/blob/main/docs/en/VSCODE.md)
- [The language](https://github.com/zawert879/factorio-automanton/blob/main/docs/en/LANGUAGE.md) — what is supported and how it differs from JavaScript

Multiplayer is supported: programs run deterministically, saving and loading in the middle of work is tested.

---

**По-русски.** Оверхол для игры с друзьями: конвейеров, буров, манипуляторов и логистических роботов нет — их работу делают автоматоны по программам на TypeScript. Программы пишутся в игре (с подсветкой) или в VS Code. Руководство игрока и справка по API — на [GitHub](https://github.com/zawert879/factorio-automanton).
