// Своя машина — me (4.4): состояние, имя и подпись, груз, топливо, параметры программы (args),
// память (memory: переживает перезапуск программы и подбор машины). Действия своей машины (19.4): me.move, me.mine,
// me.say, …; системы — me.energy (у всех), me.tank (у рабочих), me.weapon (у боевых; см. combat.ts).
import { fuelLevel } from "../../automaton/energy"
import { tankCapacity, tankOf } from "../../automaton/tank"
import { robotPosition } from "../../automaton/flight"
import { defineHostObject, host, hostGetters, hostKindClass, hostMethods, hostSetters, Val } from "../../lang/runtime/core"
import { actionError, currentMachine, currentRobot } from "../context"
import { modelOfRecord, robotBattery, robotVision } from "../../automaton/models"
import { cargoHandle, distanceBetween, ROBOT_REACH, robotHandle, robotHealth, robotProgramName, robotState } from "../handles"
import { copyValue, programPosition } from "../values"
import { text } from "./common"

defineHostObject("me")
// me instanceof Machine (19.2); Robot — только другие машины.
hostKindClass.me = "Machine"
const getters = hostGetters.me
getters.id = () => currentRobot().id
getters.name = () => currentRobot().name
getters.model = () => modelOfRecord(currentRobot()).id
getters.valid = () => true
getters.inSight = () => true
getters.position = () => programPosition(robotPosition(currentRobot()))
getters.state = () => robotState(currentRobot())
getters.program = () => robotProgramName(currentRobot())
getters.health = () => robotHealth(currentRobot())
getters.label = () => currentMachine().label ?? ""
getters.cargo = () => cargoHandle(currentRobot())
getters.fuel = () => fuelLevel(currentRobot())
getters.energy = () => energyObject
getters.tank = () => (tankCapacity(currentRobot()) <= 0 ? undefined : tankObject)
// me.weapon — в combat.ts.
getters.reach = () => ROBOT_REACH.reach
getters.mineReach = () => ROBOT_REACH.mineReach
getters.vision = () => robotVision(currentRobot())
getters.home = () => {
  const home = currentMachine().home
  return home === undefined ? undefined : programPosition(home)
}
getters.memory = () => memoryObject
getters.self = () => robotHandle(currentRobot().id)

hostSetters.me.name = (_o: Val, value: Val) => {
  const robot = currentRobot()
  robot.name = string.sub(text(value), 1, 40)
  if (robot.label.valid) robot.label.text = robot.name
}
hostSetters.me.label = (_o: Val, value: Val) => {
  const robot = currentRobot()
  const machine = currentMachine()
  machine.label = string.sub(text(value), 1, 60)
  if (robot.label.valid) {
    robot.label.text = machine.label === "" ? robot.name : `${robot.name}: ${machine.label}`
    robot.label.only_in_alt_mode = machine.label === ""
  }
}

hostMethods.me.args = () => copyValue(currentMachine().args)

// Действия своей машины (19.4) — те же функции API (move, mine, …); ищутся при вызове, поэтому с проверкой
// исследований (research.ts оборачивает их позже).
for (const name of ["move", "canReach", "follow", "goHome", "mine", "pickup", "drop", "build"]) {
  hostMethods.me[name] = (_o: Val, k: Val, ...args: Val[]) => host[name](k, ...args)
}
hostMethods.me.say = (_o: Val, _k: Val, ...args: Val[]) => host.say(...args)

// Энергия: уровень и заправка (Mk1) или зарядка (Mk2+).
const energyObject = defineHostObject("energy")
hostGetters.energy.level = () => fuelLevel(currentRobot())
hostMethods.energy.refuel = (_o: Val, k: Val, item: Val) => host.refuel(k, item)
hostMethods.energy.charge = (_o: Val, k: Val, station: Val) => host.charge(k, station)

// Бак: состояние читается при обращении (не снимок), pump — та же функция API.
const tankObject = defineHostObject("tank")
hostGetters.tank.fluid = () => {
  const tank = tankOf(currentRobot())
  return tank.amount > 0 ? tank.fluid : undefined
}
hostGetters.tank.amount = () => tankOf(currentRobot()).amount
hostGetters.tank.capacity = () => tankCapacity(currentRobot())
hostMethods.tank.pump = (_o: Val, k: Val, ...args: Val[]) => host.pump(k, ...args)
hostMethods.me.distance = (_o: Val, _k: Val, to: Val) => distanceBetween(currentRobot().entity.position, to)

// Память: значения копируются (как сообщения) — изменение прочитанного объекта не меняет память.
const memoryObject = defineHostObject("memory")
const MEMORY_KEYS = 200
hostMethods.memory.get = (_o: Val, _k: Val, key: Val) => copyValue(currentMachine().memory[text(key)])
hostMethods.memory.set = (_o: Val, _k: Val, key: Val, value: Val) => {
  const memory = currentMachine().memory
  const name = text(key)
  if (memory[name] === undefined) {
    let size = 0
    for (const [_] of pairs(memory)) size++
    if (size >= MEMORY_KEYS) actionError("limit-exceeded", `memory holds at most ${MEMORY_KEYS} keys`)
  }
  memory[name] = copyValue(value)
}
hostMethods.memory.delete = (_o: Val, _k: Val, key: Val) => {
  currentMachine().memory[text(key)] = undefined
}
