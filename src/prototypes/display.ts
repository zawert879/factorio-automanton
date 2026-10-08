// Табло (9.5): малое 3×2 клетки (96×64 пикселя) и большое 6×4 (192×128). Корпус — простое здание
// с тёмной рамкой; экран и всё нарисованное программами — объекты rendering (src/world/displays.ts).
import { PrototypeData } from "factorio:common"
import { ItemPrototype, RecipePrototype, SimpleEntityWithOwnerPrototype, Sprite } from "factorio:prototype"
import { DISPLAY_SCREEN_SPRITE, DISPLAYS, MODELS } from "../names"

declare const data: PrototypeData

const BEZEL = { r: 0.16, g: 0.17, b: 0.19 }

/** Корпус из квадратов по клетке (картинка — белый квадрат 10×10, перекрашенный). */
function bezel(width: number, height: number): Sprite {
  const layers: Sprite[] = []
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      layers.push({
        filename: "__core__/graphics/white-square.png",
        size: 10,
        scale: 3.2,
        tint: BEZEL,
        shift: [x - width / 2 + 0.5, y - height / 2 + 0.5],
      })
    }
  }
  return { layers }
}

const prototypes: object[] = []
for (const display of DISPLAYS) {
  const [w, h] = [display.tilesWide, display.tilesHigh]
  const icons = [
    { icon: "__base__/graphics/icons/display-panel.png", icon_size: 64, tint: MODELS[0].accent },
  ]
  const entity: SimpleEntityWithOwnerPrototype = {
    type: "simple-entity-with-owner",
    name: display.name,
    icons,
    flags: ["placeable-player", "player-creation"],
    minable: { mining_time: 0.3, result: display.name },
    max_health: 100,
    collision_box: [
      [-w / 2 + 0.1, -h / 2 + 0.1],
      [w / 2 - 0.1, h / 2 - 0.1],
    ],
    selection_box: [
      [-w / 2, -h / 2],
      [w / 2, h / 2],
    ],
    render_layer: "object",
    picture: bezel(w, h),
  }
  const item: ItemPrototype = {
    type: "item",
    name: display.name,
    icons,
    subgroup: "circuit-network",
    order: `z[automaton-display]-${display.name}`,
    place_result: display.name,
    stack_size: 10,
  }
  const recipe: RecipePrototype = {
    type: "recipe",
    name: display.name,
    enabled: false,
    energy_required: 3,
    ingredients: display.ingredients.map(([name, amount]) => ({ type: "item" as const, name, amount })),
    results: [{ type: "item", name: display.name, amount: 1 }],
  }
  prototypes.push(entity, item, recipe)
}

// Экран — спрайт, а не прямоугольник rendering: фигуры rendering всегда рисуются поверх спрайтов,
// и значки (тоже спрайты) иначе оказались бы под экраном.
prototypes.push({ type: "sprite", name: DISPLAY_SCREEN_SPRITE, filename: "__core__/graphics/white-square.png", size: 10, flags: ["no-crop"] })

data.extend(prototypes as never)
