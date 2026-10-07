#!/bin/sh
# Бенчмарк N физических юнитов с поиском пути: ./run.sh 5000
set -e
N="${1:-5000}"
HERE=$(cd "$(dirname "$0")" && pwd)
WORK="${TMPDIR:-/tmp}/automaton-units"
BIN="${FACTORIO_BIN:-$HOME/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio}"
rm -rf "$WORK"; mkdir -p "$WORK/data" "$WORK/mods/unitsbench"
cp "$HERE/mods/mod-list.json" "$WORK/mods/"; cp "$HERE/mods/unitsbench/info.json" "$HERE/mods/unitsbench/data.lua" "$WORK/mods/unitsbench/"
sed "s/__N__/$N/" "$HERE/mods/unitsbench/control.template.lua" > "$WORK/mods/unitsbench/control.lua"
printf '[path]\nread-data=__PATH__system-read-data__\nwrite-data=%s\n' "$WORK/data" > "$WORK/config.ini"
"$BIN" --config "$WORK/config.ini" --mod-directory "$WORK/mods" --map-gen-settings "$HERE/map-gen.json" --create "$WORK/map.zip" >/dev/null 2>&1
grep -h "UNITS placed" "$WORK/data/factorio-current.log" | sed -E 's/^.*control.lua:[0-9]+: //'
"$BIN" --config "$WORK/config.ini" --mod-directory "$WORK/mods" --benchmark "$WORK/map.zip" --benchmark-ticks 3600 --disable-audio 2>&1 | grep -E "Performed|avg|Error" || true
grep -h "UNITS tick" "$WORK/data/factorio-current.log" | sed -E 's/^.*control.lua:[0-9]+: //' | tail -1 || true
