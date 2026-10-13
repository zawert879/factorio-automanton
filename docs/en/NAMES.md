# Names

The names programs use: buildings to search for (`zone("smelter").find("stone-furnace")`, `scan.buildings({ name: … })`), items (`chest.extract("iron-plate")`, `me.mine("coal")`) and fluids (`me.tank.pump("water")`). Factorio 2.0, base game only, Automaton 0.9.0 — what the mod removes from the game is not listed. In the game, the same list is in the help (F1), section Names (with names from other mods too); VS Code suggests the names as you type. This page is made by `npm run names`.

## Buildings

By program class: `zone(…).find(Furnace)` finds every building of the class, `find("stone-furnace")` — by name.

### Chest

| Building | Name |
|---|---|
| Wooden chest | `wooden-chest` |
| Iron chest | `iron-chest` |
| Steel chest | `steel-chest` |

### Furnace

| Building | Name |
|---|---|
| Stone furnace | `stone-furnace` |
| Steel furnace | `steel-furnace` |
| Electric furnace | `electric-furnace` |

### Assembler

| Building | Name |
|---|---|
| Assembling machine 1 | `assembling-machine-1` |
| Assembling machine 2 | `assembling-machine-2` |
| Assembling machine 3 | `assembling-machine-3` |
| Oil refinery | `oil-refinery` |
| Chemical plant | `chemical-plant` |
| Centrifuge | `centrifuge` |

### RocketSilo

| Building | Name |
|---|---|
| Rocket silo | `rocket-silo` |

### Lab

| Building | Name |
|---|---|
| Lab | `lab` |

### Beacon

| Building | Name |
|---|---|
| Beacon | `beacon` |

### Boiler

| Building | Name |
|---|---|
| Boiler | `boiler` |
| Heat exchanger | `heat-exchanger` |

### Generator

| Building | Name |
|---|---|
| Steam engine | `steam-engine` |
| Steam turbine | `steam-turbine` |

### Reactor

| Building | Name |
|---|---|
| Nuclear reactor | `nuclear-reactor` |

### StorageTank

| Building | Name |
|---|---|
| Storage tank | `storage-tank` |

### Pipe

| Building | Name |
|---|---|
| Pipe | `pipe` |
| Pipe to ground | `pipe-to-ground` |
| Pump | `pump` |

### Turret

| Building | Name |
|---|---|
| Gun turret | `gun-turret` |
| Artillery turret | `artillery-turret` |

### FlameTurret

| Building | Name |
|---|---|
| Flamethrower turret | `flamethrower-turret` |

### CargoWagon

| Building | Name |
|---|---|
| Cargo wagon | `cargo-wagon` |

### FluidWagon

| Building | Name |
|---|---|
| Fluid wagon | `fluid-wagon` |

### Locomotive

| Building | Name |
|---|---|
| Locomotive | `locomotive` |

### Vehicle

| Building | Name |
|---|---|
| Car | `car` |
| Tank | `tank` |
| Spidertron | `spidertron` |

### ChargingStation

| Building | Name |
|---|---|
| Automaton charging station | `automaton-charging-station` |

### Building — buildings without a class of their own (they only have what every building has)

| Building | Name |
|---|---|
| Small electric pole | `small-electric-pole` |
| Medium electric pole | `medium-electric-pole` |
| Big electric pole | `big-electric-pole` |
| Substation | `substation` |
| Straight rail | `straight-rail` |
| Half diagonal rail | `half-diagonal-rail` |
| Curved rail | `curved-rail-a` |
| Curved rail | `curved-rail-b` |
| Train stop | `train-stop` |
| Rail signal | `rail-signal` |
| Rail chain signal | `rail-chain-signal` |
| Artillery wagon | `artillery-wagon` |
| Lamp | `small-lamp` |
| Arithmetic combinator | `arithmetic-combinator` |
| Decider combinator | `decider-combinator` |
| Selector combinator | `selector-combinator` |
| Constant combinator | `constant-combinator` |
| Power switch | `power-switch` |
| Programmable speaker | `programmable-speaker` |
| Display panel | `display-panel` |
| Large display | `automaton-display-large` |
| Small display | `automaton-display-small` |
| Solar panel | `solar-panel` |
| Accumulator | `accumulator` |
| Heat pipe | `heat-pipe` |
| Cargo landing pad | `cargo-landing-pad` |
| Wall | `stone-wall` |
| Gate | `gate` |
| Radar | `radar` |
| Land mine | `land-mine` |
| Laser turret | `laser-turret` |

## Items

### Logistics

| Item | Name |
|---|---|
| Wooden chest | `wooden-chest` |
| Iron chest | `iron-chest` |
| Steel chest | `steel-chest` |
| Storage tank | `storage-tank` |
| Small electric pole | `small-electric-pole` |
| Medium electric pole | `medium-electric-pole` |
| Big electric pole | `big-electric-pole` |
| Substation | `substation` |
| Pipe | `pipe` |
| Pipe to ground | `pipe-to-ground` |
| Pump | `pump` |
| Rail | `rail` |
| Train stop | `train-stop` |
| Rail signal | `rail-signal` |
| Rail chain signal | `rail-chain-signal` |
| Locomotive | `locomotive` |
| Cargo wagon | `cargo-wagon` |
| Fluid wagon | `fluid-wagon` |
| Artillery wagon | `artillery-wagon` |
| Car | `car` |
| Tank | `tank` |
| Spidertron | `spidertron` |
| A machine gun on an automaton chassis: guards posts and routes (me.weapon: attack, guard, patrol). Ammo — me.weapon.reload() from cargo. | `automaton-combat-mk1` |
| A rocket launcher on an automaton chassis: for nests and worms. Rockets — me.weapon.reload() from cargo. | `automaton-combat-mk2` |
| Flying automaton Mk1 | `automaton-flyer-mk1` |
| Flying automaton Mk2 | `automaton-flyer-mk2` |
| Worker automaton Mk1 | `automaton-worker-mk1` |
| Worker automaton Mk2 | `automaton-worker-mk2` |
| Worker automaton Mk3 | `automaton-worker-mk3` |
| Automaton marker | `automaton-marker` |
| Signal marker | `automaton-signal-marker` |
| Construction robot | `construction-robot` |
| Lamp | `small-lamp` |
| Arithmetic combinator | `arithmetic-combinator` |
| Decider combinator | `decider-combinator` |
| Selector combinator | `selector-combinator` |
| Constant combinator | `constant-combinator` |
| Power switch | `power-switch` |
| Programmable speaker | `programmable-speaker` |
| Display panel | `display-panel` |
| Large display (192×128) | `automaton-display-large` |
| Small display (96×64) | `automaton-display-small` |
| Stone brick | `stone-brick` |
| Concrete | `concrete` |
| Hazard concrete | `hazard-concrete` |
| Refined concrete | `refined-concrete` |
| Refined hazard concrete | `refined-hazard-concrete` |
| Landfill | `landfill` |
| Cliff explosives | `cliff-explosives` |

### Production

| Item | Name |
|---|---|
| Repair pack | `repair-pack` |
| Boiler | `boiler` |
| Steam engine | `steam-engine` |
| Solar panel | `solar-panel` |
| Accumulator | `accumulator` |
| Automaton charging station | `automaton-charging-station` |
| Nuclear reactor | `nuclear-reactor` |
| Heat pipe | `heat-pipe` |
| Heat exchanger | `heat-exchanger` |
| Steam turbine | `steam-turbine` |
| Stone furnace | `stone-furnace` |
| Steel furnace | `steel-furnace` |
| Electric furnace | `electric-furnace` |
| Assembling machine 1 | `assembling-machine-1` |
| Assembling machine 2 | `assembling-machine-2` |
| Assembling machine 3 | `assembling-machine-3` |
| Oil refinery | `oil-refinery` |
| Chemical plant | `chemical-plant` |
| Centrifuge | `centrifuge` |
| Lab | `lab` |
| Beacon | `beacon` |
| Speed module | `speed-module` |
| Speed module 2 | `speed-module-2` |
| Speed module 3 | `speed-module-3` |
| Efficiency module | `efficiency-module` |
| Efficiency module 2 | `efficiency-module-2` |
| Efficiency module 3 | `efficiency-module-3` |
| Productivity module | `productivity-module` |
| Productivity module 2 | `productivity-module-2` |
| Productivity module 3 | `productivity-module-3` |
| Rocket silo | `rocket-silo` |
| Cargo landing pad | `cargo-landing-pad` |
| Satellite | `satellite` |

### Intermediate products

| Item | Name |
|---|---|
| Wood | `wood` |
| Coal | `coal` |
| Stone | `stone` |
| Iron ore | `iron-ore` |
| Copper ore | `copper-ore` |
| Uranium ore | `uranium-ore` |
| Raw fish | `raw-fish` |
| Iron plate | `iron-plate` |
| Copper plate | `copper-plate` |
| Steel plate | `steel-plate` |
| Solid fuel | `solid-fuel` |
| Plastic bar | `plastic-bar` |
| Sulfur | `sulfur` |
| Battery | `battery` |
| Explosives | `explosives` |
| water-barrel | `water-barrel` |
| Crude oil barrel | `crude-oil-barrel` |
| petroleum-gas-barrel | `petroleum-gas-barrel` |
| light-oil-barrel | `light-oil-barrel` |
| heavy-oil-barrel | `heavy-oil-barrel` |
| lubricant-barrel | `lubricant-barrel` |
| sulfuric-acid-barrel | `sulfuric-acid-barrel` |
| Iron gear wheel | `iron-gear-wheel` |
| Iron stick | `iron-stick` |
| Copper cable | `copper-cable` |
| Barrel | `barrel` |
| Electronic circuit | `electronic-circuit` |
| Advanced circuit | `advanced-circuit` |
| Processing unit | `processing-unit` |
| Engine unit | `engine-unit` |
| Electric engine unit | `electric-engine-unit` |
| Flying robot frame | `flying-robot-frame` |
| Low density structure | `low-density-structure` |
| Rocket fuel | `rocket-fuel` |
| Uranium-235 | `uranium-235` |
| Uranium-238 | `uranium-238` |
| Uranium fuel cell | `uranium-fuel-cell` |
| Depleted uranium fuel cell | `depleted-uranium-fuel-cell` |
| Nuclear fuel | `nuclear-fuel` |
| Automation science pack | `automation-science-pack` |
| Logistic science pack | `logistic-science-pack` |
| Military science pack | `military-science-pack` |
| Chemical science pack | `chemical-science-pack` |
| Production science pack | `production-science-pack` |
| Utility science pack | `utility-science-pack` |
| Space science pack | `space-science-pack` |

### Combat

| Item | Name |
|---|---|
| Pistol | `pistol` |
| Submachine gun | `submachine-gun` |
| Shotgun | `shotgun` |
| Combat shotgun | `combat-shotgun` |
| Rocket launcher | `rocket-launcher` |
| Flamethrower | `flamethrower` |
| Firearm magazine | `firearm-magazine` |
| Piercing rounds magazine | `piercing-rounds-magazine` |
| Uranium rounds magazine | `uranium-rounds-magazine` |
| Shotgun shells | `shotgun-shell` |
| Piercing shotgun shells | `piercing-shotgun-shell` |
| Cannon shell | `cannon-shell` |
| Explosive cannon shell | `explosive-cannon-shell` |
| Uranium cannon shell | `uranium-cannon-shell` |
| Explosive uranium cannon shell | `explosive-uranium-cannon-shell` |
| Artillery shell | `artillery-shell` |
| Rocket | `rocket` |
| Explosive rocket | `explosive-rocket` |
| Atomic bomb | `atomic-bomb` |
| Flamethrower ammo | `flamethrower-ammo` |
| Grenade | `grenade` |
| Cluster grenade | `cluster-grenade` |
| Poison capsule | `poison-capsule` |
| Slowdown capsule | `slowdown-capsule` |
| Light armor | `light-armor` |
| Heavy armor | `heavy-armor` |
| Modular armor | `modular-armor` |
| Power armor | `power-armor` |
| Power armor MK2 | `power-armor-mk2` |
| Portable solar panel | `solar-panel-equipment` |
| Portable fission reactor | `fission-reactor-equipment` |
| Personal battery | `battery-equipment` |
| Personal battery MK2 | `battery-mk2-equipment` |
| Belt immunity equipment | `belt-immunity-equipment` |
| Exoskeleton | `exoskeleton-equipment` |
| Personal roboport | `personal-roboport-equipment` |
| Personal roboport MK2 | `personal-roboport-mk2-equipment` |
| Nightvision | `night-vision-equipment` |
| Energy shield | `energy-shield-equipment` |
| Energy shield MK2 | `energy-shield-mk2-equipment` |
| Personal laser defense | `personal-laser-defense-equipment` |
| Discharge defense | `discharge-defense-equipment` |
| Wall | `stone-wall` |
| Gate | `gate` |
| Radar | `radar` |
| Land mine | `land-mine` |
| Gun turret | `gun-turret` |
| Laser turret | `laser-turret` |
| Flamethrower turret | `flamethrower-turret` |
| Artillery turret | `artillery-turret` |

## Fluids

| Fluid | Name |
|---|---|
| Water | `water` |
| Steam | `steam` |
| Crude oil | `crude-oil` |
| Petroleum gas | `petroleum-gas` |
| Light oil | `light-oil` |
| Heavy oil | `heavy-oil` |
| Lubricant | `lubricant` |
| Sulfuric acid | `sulfuric-acid` |
