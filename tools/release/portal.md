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
- **Editor in the game** with syntax highlighting, and **VS Code integration**: autocompletion, documentation on hover, publishing on save, a separate program folder per save.
- **Modules**: `import` / `export` between team programs, your own libraries, folders.
- **Everything automatons do**: mining, smelting, crafting, fluids (pumping, crude oil, uranium), building and deconstructing, messaging by subscription, a shared board and task queues, pixel displays, circuit network signals.
- **Combat automatons** (machine gun, rocket launcher) — biters attack your machines and routes — and **flying haulers**.
- **Progression**: worker models Mk1–Mk3, charging stations, research that unlocks API features and more processor time.
- **Starter kit** in freeplay: two automatons, markers and ready-made example programs (miner, smelter, hauler, water carrier…).
- **Scales**: 10 000 machines with programs run at 60 UPS.

## Getting started

Start a new freeplay game: you get two automatons and markers, and the team library already has example programs. Open a machine (click it), pick a program and press Run. The full player guide, API reference and language description are on [GitHub](https://github.com/zawert879/factorio-automanton) (in Russian; the in-game texts are in English and Russian).

Multiplayer is supported: programs run deterministically, saving and loading in the middle of work is tested.

---

**По-русски.** Оверхол для игры с друзьями: конвейеров, буров, манипуляторов и логистических роботов нет — их работу делают автоматоны по программам на TypeScript. Программы пишутся в игре (с подсветкой) или в VS Code. Руководство игрока и справка по API — на [GitHub](https://github.com/zawert879/factorio-automanton).
