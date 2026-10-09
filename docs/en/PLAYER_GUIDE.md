# Automaton — player guide

This game has no belts, drills, inserters, logistic robots or offshore pump.
Their work is done by **automatons** — machines that run your TypeScript programs.
You build the factory from routes and algorithms instead of belts: "drive to the ore, mine it, take it to the furnace".

![A science factory run by machines](../media/factory.gif)

References: [API.md](../API.md) — every machine function (in Russian; with the game in English the same descriptions
are in the in-game help, F1, and in the VS Code types), [LANGUAGE.md](LANGUAGE.md) — the language and how it differs
from JavaScript, [VSCODE.md](VSCODE.md) — writing programs in VS Code.

- [The first 15 minutes](#the-first-15-minutes)
- [The machine and its window](#the-machine-and-its-window)
- [Programs](#programs)
- [Your own libraries](#your-own-libraries)
- [Sharing programs](#sharing-programs)
- [The language in five minutes](#the-language-in-five-minutes)
- [How a machine thinks](#how-a-machine-thinks)
- [The world: markers, zones, vision](#the-world-markers-zones-vision)
- [Recipes](#recipes)
- [Progression](#progression)
- [Walkthrough: the science factory](#walkthrough-the-science-factory)
- [Multiplayer](#multiplayer)
- [Debugging and common errors](#debugging-and-common-errors)

## The first 15 minutes

A freeplay game starts with two **Worker automatons Mk1** and four **markers** instead of a drill and a furnace.
The team library is empty: you write the programs. **Help** on every function, with examples, is right in the game:
F1 or "?" on the shortcut bar (search by name, "First steps", "Common errors").

1. **Depot.** Place a wooden chest. Put a marker next to it — a name window opens; name the marker
   `depot`.
2. **Your first program.** Place an automaton next to a coal field and click it. In the machine
   window press **Programs…** → **New**, name the program `Miner`, paste the code and press
   **Publish**:

   ```ts
   // Miner: mines ore at a resource field and carries it to the chest at the "depot" marker.
   const { ore } = me.args<{ ore?: Item }>()
   const item: Item = ore ?? "coal"
   const field = scan.resources().find((p) => p.item === item)!.nearest
   while (true) {
     move(field)
     mine(item)
     // A coal miner also tops up its own fuel.
     if (item === "coal" && me.fuel < 0.5) refuel("coal")
     move(marker("depot"), { radius: 2 })
     put(scan.entities({ type: "container" })[0], item)
   }
   ```

   At the bottom of the window press **Assign to …** (the button shows the machine's name, like "Assign to AM-1"),
   then **Run** in the machine window. The machine mines some coal, takes it to the chest at the `depot` marker and comes back.
3. **A miner for iron.** Put the second machine at the iron ore: the same program (the button with the program name
   in the machine window), and in the **Parameters** field enter `{"ore": "iron-ore"}`. One program, different
   settings on different machines. Give it coal as fuel: take coal in your hand and click the fuel slot
   in the machine window while standing next to it.
4. **Smelting.** Craft a few stone furnaces and place them together. With the **Programmer** shortcut
   on the shortcut bar, drag a box around them and name the zone `smelting`. Place a second
   chest and a `plates` marker. For the third machine, write a smelter: take ore and coal from the depot, load them
   into the zone's furnaces (`find("stone-furnace", zone("smelting"))`), collect the plates and take them to the `plates` marker.
5. **New machines** are crafted from iron plates and gears — the recipe is available from the start.

More advanced ready-made examples are in the [examples](../../examples) folder: a smelter, a water carrier, a route hauler,
a storekeeper, an orchestrator with workers, a patrol. Many of them use the library
[examples/helpers.ts](../../examples/helpers.ts) — publish it under the name `lib/Помощники` ("Helpers"). The examples
are commented in Russian and use Russian marker names by default (`склад` = depot); give them your names in the
**Parameters** field — each example lists its parameters at the top.

![Coal miners: they mine at the field and haul to the depot](../media/miners.gif)

Next comes electricity. There is no offshore pump: **machines carry water to the boilers**. Craft a boiler —
this unlocks the **Automaton fluids** research. Put a storage tank next to the boilers (a boiler holds
only 200 water), a `boilers` marker, and write a water carrier: `pump` at a lake, `drain` into the tank (example:
[examples/water.ts](../../examples/water.ts), parameters `{"target": "boilers"}`). One water carrier serves about one boiler.

![A water carrier fills up at a lake and drives to the boiler](../media/water.gif)

## The machine and its window

Click a machine to open its window:

![The machine window](../media/machine-window.png)


- **Program** — the button with the program's name opens the **Choose a program** window: search, folders, how many
  machines already run each program, recent ones on top. **Run**, **Stop**, **Pause**, **Step**.

  ![The program picker](../media/picker.png)

- **Parameters** — JSON that the program reads with `me.args()`.
- **Console** — the last 100 lines of `print` output and error messages; the current program line.
- **Cargo, Fuel, Tank** — what the machine carries and how much energy it has. Standing next to it, you can move
  items by hand: click with an item in hand to put it into the cargo or the fuel slot, with an empty hand to take it.
- **Name and Home** — the name is shown above the machine (Alt mode); home is the point for `goHome()`.

A machine you pick up remembers its name, number, energy and tank, and its program and parameters wait until
the machine is placed again. A destroyed machine spills its cargo on the ground.

**All machines** — a shortcut on the shortcut bar (or **Machines: N** next to a program in the programs window):
a table of your team's machines with program, state and fuel; sort by column, search, filters **With errors**,
**No fuel**, **Idle** and by program. Click a machine for a remote view of it and its window.

**Blueprints** remember machines: their program and parameters. Select an area with machines (or press Ctrl+C) —
the blueprint places the same machines with the same programs, and they start working right away (with new names).
The selection must contain at least one building (a chest, a pole): the game won't make a blueprint from machines
alone. If your team has no program with that name (a blueprint from another game), the machine is placed without
a program — send the programs over as an export string.

Setting up many machines at once:

- **Copy settings** — Shift+right-click a machine (the same keys as for buildings) to copy its program
  and parameters, Shift+left-click another machine to paste them and start it.
- **Programmer with the right button** — right-drag a box over machines to open the program picker: the program
  starts on every machine in the box. Shift+right-drag stops them. (Left-dragging with the Programmer
  still selects zones.)

An icon above a machine shows a problem: out of fuel, no path, cargo full, program error.
A program error and a stuck machine also raise an alert by the minimap.

## Programs

Programs are shared by the whole team. **Programs…** in the machine window opens the full-screen
**editor**: line numbers, errors highlighted when you publish, a click on an error selects its line.
Unpublished text is kept as a draft.

- **Publishing** compiles the program: a program with an error is not published — the error shows in the editor.
- **A new version** restarts every machine running it (`me.memory` is kept).
- A program keeps its last 10 versions; you can open an old one and publish it again.
- A program that keeps hitting the limits (memory, infinite recursion) goes into **quarantine**
  and stops on all machines; a new version lifts the quarantine.

The game also checks **types**: `me.cargo.cout("coal")` — "property 'cout' does not exist on type Inventory",
`wait("5")` — "type "5" is not assignable to number". The check is lenient: it reports an error only where
it is certain.

A program opens **highlighted** (**View**). To change it, press **Edit** or click a line:
a text box opens with the cursor on that line. After publishing it is back to View; errors are shown
on their lines: a red "●" by the line number, the faulty spot in red, the error text at the end of the line.
**Check** (and switching to **View**) looks for errors without publishing: machines running the program keep working.

Programs can be sorted **into folders**: the name `Logistics/Hauler` puts the program into the folder
"Logistics". The list on the left is a tree (click a folder to collapse it) with search by name.

You can write in the game's editor, but **VS Code** is more comfortable: completion, documentation on hover,
errors before publishing; save the file and the program is published. Setup: [VSCODE.md](VSCODE.md).

![Highlighted view → editing a line → publishing with errors shown in red on their lines → after the fix, "Published"](../media/editor.gif)

## Your own libraries

A program can **import** other team programs, like modules in TypeScript. Shared functions are
written once in a library, and other programs import it. An example is the `lib/Помощники` ("Helpers") library
([examples/helpers.ts](../../examples/helpers.ts)): the example miner, smelter, digger
and hauler are built on it:

```ts
import { attempt, chestAt, nearestField } from "./lib/Помощники";

// Mine iron ore nearby and put it into the chest at the "ore" marker.
const field = nearestField("iron-ore");
while (true) {
  move(field);
  attempt(() => mine("iron-ore", 20));
  const chest = chestAt("ore");
  attempt(() => put(chest, "iron-ore"), "chest");
}
```

A library of your own is an ordinary program with `export` in front of its functions, constants, classes and types:

```ts
// The program "lib/Depot"
export const DEPOTS = { coal: "coal", iron: "iron" };

export function stock(chest: Entity, item: Item): number {
  return chest.count(item);
}
```

- **The path** is relative to the program's folder: from `Mining/Miner` the library `lib/Depot` is `"../lib/Depot"`,
  from a program at the root it is `"./lib/Depot"`. In VS Code these are the same paths between files.
- **A library** is a program with only declarations and at least one `export`. It is marked in the list and cannot
  be run on a machine. You can see who imports it; while anything imports it, it cannot be deleted.
- **Changed a library?** Every program that imports it is rebuilt and its machines
  restart. If one of them doesn't build with the new version (say, a function it needs is gone), it
  keeps running the previous build and gets a "⚠" with the error text in the list.
- **Renamed or moved** a library to another folder? Import paths in the programs are fixed automatically.
- An error inside a library is shown with its name: `lib/Depot:12: Error: …`.

## Sharing programs

Programs travel as **strings**, like blueprints: to a friend on another team, to another save, to a forum.

- **Export** (the bottom row of the programs window): tick programs or folders — the modules they can't build
  without are ticked automatically. The `am1:…` string at the bottom of the window is already selected: press Ctrl+C.
- **Import**: paste the string — the window shows what's in it: new programs, unchanged ones (they are skipped) and
  ones your team has with different text. For those, choose **Replace** (a new version; the old one stays in the version
  history), **Alongside "(2)"** (as "Miner (2)") or **Skip**. **Import** publishes them — with the same rights as publishing.

Details (what can be imported, `import * as`, `export default`) — [LANGUAGE.md](LANGUAGE.md), "Modules".

## The language in five minutes

A program is plain TypeScript, just without `async`/`await`: machine actions simply wait until they're done.

```ts
// Variables and types
const ore: Item = "iron-ore"
let trips = 0

// Functions, arrow functions, closures
const lowOn = (item: Item, below: number) => (e: Entity) => e.count(item) < below

// Objects, arrays, destructuring, ?. and ??
const { depot = "depot" } = me.args<{ depot?: string }>()
const hungry = scan.entities({ type: "furnace" }).filter(lowOn("coal", 5))
const first = hungry[0]?.position ?? me.position

// Classes and interfaces
interface Job { ready(): boolean; run(): void }
class Feed implements Job {
  constructor(readonly furnace: Entity) {}
  ready(): boolean { return this.furnace.count("coal") < 5 }
  run(): void { move(this.furnace); put(this.furnace, "coal", 5) }
}

// Action errors are an ActionError with a code
try {
  mine(ore, 50)
} catch (e) {
  if (e instanceof ActionError && e.code === "no-resource") say("out of ore")
  else throw e
}

// Collections
const seen = new Set<number>()
const counts = new Map<Item, number>()
for (const stack of me.cargo.items()) counts.set(stack.name, stack.count)
```

What's missing (and what to write instead): `var` → `let`/`const`, `async`/`await` → not needed, regular
expressions → string methods, `enum` → a union of strings (`type Dir = "north" | "south"`), `==` → `===`.
`null` and `undefined` are the same thing. Details — [LANGUAGE.md](LANGUAGE.md).

## How a machine thinks

- **Actions wait.** `move`, `mine`, `put`, `take`, `pump`, `wait`… return control when the job
  is done. While the machine is driving, its program is paused and uses no resources.
- **Quantum.** Each tick a machine runs up to 50 instructions (Mk2 — 100, Mk3 — 200, more with
  the **Automaton processor** research). A long loop without actions just stretches over several ticks —
  it won't slow the game down. Details below, in [Time: quantum, waiting, debt](#time-quantum-waiting-debt).
- **Hands and eyes reach only so far.** A machine works with a building within `me.reach` (10 tiles, like the
  character) and sees within `me.vision` (10 tiles; more with **Automaton sensors** and later models).
  A distant building is only known to exist — to learn its state, drive up to it or ask
  a machine that is nearby.
- **Energy.** Mk1 burns fuel from its fuel slot (`refuel` moves it there from the cargo, `refuel("coal", robot)` —
  into a nearby machine's slot, a player puts it in through the machine window), Mk2 and up charge a battery
  at a charging station (`charge`).
- **Memory.** Variables live while the program runs; `me.memory` survives a restart
  and the machine being picked up.

### Time: quantum, waiting, debt

Not all of a program's lines run in the same tick. The rules are:

1. **A loop iteration costs 1 instruction** of the quantum, and so does a call to a "long" function (one with a loop or an action).
   Ordinary expressions and short functions are free. When the quantum runs out, the program pauses until the next tick.
2. **Waiting doesn't use the quantum.** While the machine drives, mines or waits (`wait`, `receive`), its program
   is paused and costs nothing.
3. **A heavy call runs at once, and the machine rests afterwards.** `publish` to a thousand subscribers, `sort` of a big
   array, `map` over a big array run in full in the current tick, and the machine pays off the overspend over
   the next ticks (it skips them). The costs are in [API.md, "Время программы" (program time)](../API.md#время-программы).

An example on Mk1: look at the coal in a chest → notify 120 subscribers → send a task to
100 helpers in a loop → take the coal. The messages to subscribers go out in the first tick, then the machine
"rests" for two ticks, the loop runs for two more — and only in the fifth tick does it take the coal. That's less than
a tenth of a second, but **the world changes in the meantime**: another machine may have taken the coal.

Practical advice that follows from this:

- **Check the result of an action instead of assuming it.** `take` returns how much was actually taken;
  if there is nothing to take, it throws `ActionError("not-enough-items")`. The `lib/Помощники` library has `attempt` for this.
- **Don't optimize for the quantum.** A long loop just takes longer; that doesn't break the program.
- **Wait with `wait` and actions**, not with an empty loop: waiting is free, an empty loop burns the quantum.
- **Many machines compute at the same time** — together they share a per-tick budget (the map setting "Program
  instructions per tick (all robots)"). If it runs out, some machines get their turn a tick later: the machines think
  slower, the game doesn't lag.

Action errors are an `ActionError` with a code:

| Code | What happened |
|---|---|
| `no-path` / `stuck` | No path / the machine is boxed in |
| `out-of-reach` | The building is more than 10 tiles away — `move` first |
| `out-of-sight` | The building's state isn't visible — drive closer |
| `invalid-target` | The target is gone or isn't suitable |
| `no-fuel` | Out of energy |
| `cargo-full` / `target-full` | The cargo is full / the building has no room |
| `not-enough-items` | The cargo doesn't have the item |
| `no-resource` | Nothing to mine nearby |
| `not-researched` | The function is unlocked by research |
| `timeout` | The timeout ran out (`request`, `move` with `timeout`) |

## The world: markers, zones, vision

- **Marker** — a named flag that machines can drive through. `marker("depot")` is its position.
  To rename it, hover the cursor over it and type `/am-name`.
- **Zone** — a rectangle selected with the **Programmer** (left-drag). `zone("smelting")`, and
  `find("stone-furnace", zone("smelting"))` gives the furnaces in it at any distance.
- **Vision** — `scan.entities(...)`, `scan.resources()`, `scan.robots()`, `scan.items()`,
  `scan.water()` and (with **Automaton sensors 2**) `scan.enemies()`: only within the vision radius, nearest first.
- **Map** — `map.tag(position, text, icon)` puts a tag on the map for all players.

## Recipes

**A miner with a fuel reserve**

```ts
const field = scan.resources().find((p) => p.item === "coal")!.nearest
while (true) {
  move(field)
  mine("coal")
  if (me.fuel < 0.5) refuel("coal")
  move(marker("depot"), { radius: 2 })
  put(scan.entities({ type: "container" })[0], "coal")
}
```

**Feed every furnace in a zone**

```ts
for (const furnace of find({ type: "furnace" }, zone("smelting"))) {
  move(furnace)
  if (furnace.count("coal") < 5) put(furnace, "coal", 5)
  put(furnace, "iron-ore", 10)
}
```

**Ask a machine that can see the depot** (needs **Automaton radio**)

```ts
const coal = request<number>("storekeeper", "how-many", "coal", 10)
print(`${coal} coal in the depot`)
```

**Share work without conflicts** — claims on the board

```ts
for (const furnace of find({ type: "furnace" }, zone("smelting"))) {
  if (!board.claim(`furnace-${furnace.id}`, 30)) continue  // another machine is already feeding this furnace
  move(furnace)
  put(furnace, "iron-ore", 20)
  board.release(`furnace-${furnace.id}`)
}
```

**A task queue**

```ts
// Dispatcher
tasks.push("delivery", { item: "iron-plate", to: "assembly" }, { priority: 5 })

// Worker: a task not finished within 60 s goes back to the queue
const task = tasks.next<{ item: Item; to: string }>("delivery")!
move(marker(task.data.to))
task.done()
```

**A display**

![A depot display: the numbers and the bar are updated frame by frame](../media/display.gif)

```ts
const screen = display("hq")
screen.frame(() => {
  screen.clear("black")
  screen.text(4, 4, `Coal: ${board.get<number>("coal") ?? 0}`, { color: "yellow", size: 12 })
  screen.bar(4, 24, screen.width - 8, 6, me.fuel, "green")
})
```

Complete programs are in the [examples](../../examples) folder and in [API.md](../API.md): an orchestrator with workers and a display,
a scout, a patrol.

## Progression

| Research | What it gives |
|---|---|
| Automaton radio (in place of Logistics) | messages, `robot()`, the board, task queues |
| Display | small and large displays, `display()` |
| Tuning | `setRecipe` — machines change assembler recipes themselves |
| Automaton fluids (craft a boiler) | the tank, `pump`, `fill`, `drain` |
| Automaton construction | `build`, `deconstruct`, `rotate` |
| Automatons and circuits | the signal marker, `signals` |
| Automaton sensors 1–3 | vision of 16 / 24 / 32 tiles, `scan.enemies` |
| Automaton Mk2, Mk3 | electric models, the charging station |
| Combat automatons 1–2 | machine gun and rocket launcher, `attack`, `guard`, `patrol`, `reload` |
| Flying automatons 1–2 | haulers that fly in a straight line over everything |
| Automaton speed, cargo, mining, processor, memory, tanks 1–3 | upgrades for all machines |

![The technology tree: Automaton radio in place of Logistics](../media/tech-tree.png)

![Models: workers Mk1–Mk3, the charging station, combat Mk1–Mk2](../media/models.png)

| Model | Speed | Cargo | Tank | Energy | Special |
|---|---|---|---|---|---|
| Worker Mk1 | 6 tiles/s | 10 | 1000 | fuel | — |
| Worker Mk2 | 8.4 | 20 | 2000 | battery 10 MJ | — |
| Worker Mk3 | 10.8 | 30 | 4000 | battery 25 MJ | — |
| Combat Mk1 | 7.2 | 5 | — | fuel | machine gun, 350 health |
| Combat Mk2 | 7.8 | 5 | — | battery | rocket launcher, 700 health |
| Flying Mk1 | 15 | 2 | — | battery 5 MJ | doesn't mine |
| Flying Mk2 | 24 | 4 | — | battery 10 MJ | doesn't mine |

Combat machines fight back on their own — the engine handles the fighting, the program only decides where to stand or where to go:

![A guard (guard) and biters](../media/combat.gif)

Flying haulers fly in a straight line over everything — for long routes and large scales:

![Flying shuttles between two markers](../media/flyers.gif)

## Walkthrough: the science factory

The `automaton-science` save (or `/am-science` on your own map) is a red and green science factory
run entirely by machines. It is built from three example programs with different parameters — `Добытчик` (digger),
`Перевозчик` (hauler) and `Водовоз` (water carrier) from [examples](../../examples) (`/am-science` publishes them to your
team) — and you can build any production chain the same way.

![Assemblers for gears, cable, circuits, red and green science, and labs](../media/assembly.gif)

The demo names its markers and zones in Russian; the meaning is given in parentheses.
**Depots** are wooden chests, each with a marker next to it: `уголь` (coal), `железная руда` (iron ore), `медная руда` (copper ore),
`железо` (iron plates), `медь` (copper plates), `наука` (science). **Zones** (drawn with the Programmer) group buildings:
`печи-железо` (iron furnaces), `печи-медь` (copper furnaces), `котельная` (boilers), `шестерни` (gears), `провод` (cable),
`схемы` (circuits), `красная` (red science), `зелёная` (green science), `лаборатории` (labs).

**Diggers** (9 machines) mine ore and carry it to a depot; they take fuel from the coal depot:

```json
{"ore": "iron-ore", "depot": "железная руда"}
```

**The water carrier** fills up at a lake and pours the water into the boiler; it takes coal for the boiler and for itself from the chest by the boilers.

**Haulers** (6 machines) follow "from → to" routes. A route takes an item from the chest at a marker
or from the buildings of a zone, and puts it into the buildings of a zone (up to `keep` items in each) or into a chest. For example,
the smelting hauler:

```json
{"routes": [
  {"item": "iron-ore",   "from": {"marker": "железная руда"}, "to": {"zone": "печи-железо"}, "keep": 20, "batch": 80},
  {"item": "coal",       "from": {"marker": "уголь"},         "to": {"zone": "печи-железо"}, "keep": 5,  "batch": 20},
  {"item": "iron-plate", "from": {"zone": "печи-железо"},     "to": {"marker": "железо"}}
]}
```

and the assembly hauler:

```json
{"routes": [
  {"item": "iron-plate",         "from": {"marker": "железо"},  "to": {"zone": "схемы"},   "keep": 20, "batch": 40},
  {"item": "copper-cable",       "from": {"zone": "провод"},    "to": {"zone": "схемы"},   "keep": 30},
  {"item": "electronic-circuit", "from": {"zone": "схемы"},     "to": {"zone": "зелёная"}, "keep": 10},
  {"item": "iron-plate",         "from": {"marker": "железо"},  "to": {"zone": "зелёная"}, "keep": 10, "batch": 20}
]}
```

![A hauler feeds the furnaces with ore and coal and takes the plates to the depot](../media/smelting.gif)

What to borrow when you build your own:

- **Coal first.** Without coal everything stops: the furnaces, the boiler, the machines. You need more coal miners than you think,
  plus a starting stock at the depot.
- **keep for chests.** A route into a chest without `keep` unloads everything the machine carries; with `keep`, only up to
  that amount (otherwise coal, for example, would drain away into the chest by the boilers).
- **The bottleneck shows in the machine window.** A hauler that keeps waiting at an empty depot means too few diggers;
  one that stands at full furnaces means the furnaces need coal.
- **More machines — more routes in parallel.** One hauler per 3–4 routes; split a long chain
  between several of them.

## Multiplayer

- Programs, markers, zones, displays, the board and tasks are shared by the team.
- Who can publish is set by the map setting "Who can publish programs" (everyone or admins only).
- Machines run identically for every player; someone who joins mid-game gets everything as it is.
- Load: 300 machines running programs add about 0.6 ms per tick (a tick is 16.7 ms).

## Debugging and common errors

- **The machine console** — in its window; from chat: `/am-log <id> [lines]`.
- **Pause and Step** in the machine window: **Step** runs to the next program line, and the current line is shown.
- **Debug…** in the machine window opens the debug window: the program's code highlighted; click a line number to set
  a **breakpoint** (for this machine only — others with the same program keep working), and the machine stops before that line.
  **Continue**, **Step**, **Pause**; on the right are the **variables** of the program and its modules, `me.memory` and the parameters.
  Grey line numbers are where it can't stop (declarations and short functions without loops and actions).
- `/am-info <id>` — the machine's state, `/am-look` — the building under the cursor as machines see it,
  `/am-run <id> <program>`, `/am-stop <id>`, `/am-args <id> {…}`, `/am-home <id>`.

| You see | Cause |
|---|---|
| `out-of-reach` on `put`/`take` | you forgot to `move` to the building |
| `out-of-sight` when reading `furnace.count(…)` | the building is far away — drive closer or ask over the radio |
| `no-path` | the target is behind water or a wall; `canReach(...)` checks in advance |
| the machine stands still with a fuel icon | `refuel` from the cargo (Mk1) or `charge()` at a station (Mk2+) |
| `not-researched` | the required research isn't done yet |
| the program is "quarantined" | fix the infinite recursion or the memory growth and publish again |
