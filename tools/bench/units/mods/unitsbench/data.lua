local u = table.deepcopy(data.raw.unit["small-biter"])
u.name = "bench-unit"
u.ai_settings = { allow_destroy_when_commands_fail = false, allow_try_return_to_spawner = false, do_separation = true }
data:extend({ u })
