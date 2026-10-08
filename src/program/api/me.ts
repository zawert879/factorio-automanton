// Своя машина — me (4.4): состояние, имя и подпись, груз, топливо, параметры программы (args),
// память (memory: переживает перезапуск программы и подбор машины).
import { fuelValue } from "../../automaton/energy"
import { tankCapacity, tankOf } from "../../automaton/tank"
import { charge, defineHostObject, hostGetters, hostMethods, hostSetters, Val } from "../../lang/runtime/core"
import { actionError, currentMachine, currentRobot } from "../context"
import { modelOfRecord, robotBattery, robotVision } from "../../automaton/models"
import { cargoHandle, distanceBetween, ROBOT_REACH, robotHandle, robotHealth, robotProgramName, robotState } from "../handles"
import { copyValue, programPosition } from "../values"
import { text } from "./common"

/** Полный бак — стопка угля в топливном слоте (баланс — этап 8). */
const FULL_TANK_JOULES = 50 * 4_000_000

defineHostObject("me")
const getters = hostGetters.me
getters.id = () => currentRobot().id
getters.name = () => currentRobot().name
getters.model = () => modelOfRecord(currentRobot()).id
getters.valid = () => true
getters.inSight = () => true
getters.position = () => programPosition(currentRobot().entity.position)
getters.state = () => robotState(currentRobot())
getters.program = () => robotProgramName(currentRobot())
getters.health = () => robotHealth(currentRobot())
getters.label = () => currentMachine().label ?? ""
getters.cargo = () => cargoHandle(currentRobot())
getters.fuel = () => {
  const robot = currentRobot()
  const battery = robotBattery(robot)
  if (battery !== undefined) return math.min(1, robot.energy / battery)
  const stack = robot.fuel[0]
  const stored = robot.energy + (stack.valid_for_read ? stack.count * fuelValue(stack.name) : 0)
  return math.min(1, stored / FULL_TANK_JOULES)
}
getters.tank = () => {
  const robot = currentRobot()
  const tank = tankOf(robot)
  charge(1)
  return { fluid: tank.amount > 0 ? tank.fluid : undefined, amount: tank.amount, capacity: tankCapacity(robot) }
}
getters.weapon = () => undefined
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
