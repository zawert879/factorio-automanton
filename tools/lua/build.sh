#!/bin/sh
# Собирает Lua 5.2 (ветка, на которой основан Lua в Factorio) в tools/lua/5.2/bin/lua.
# Нужен для тестов вне игры. Повторный запуск ничего не делает, если lua уже собран.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
VERSION=5.2.4
SHA256=b9e2e4aad6789b3b63a056d442f7b39f0ecfca3ae0f1fc0ae4e9614401b69f4b
PREFIX="$HERE/5.2"

if [ -x "$PREFIX/bin/lua" ]; then
  exit 0
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
curl -sSfL --max-time 120 -o "$WORK/lua.tar.gz" "https://www.lua.org/ftp/lua-$VERSION.tar.gz"
echo "$SHA256  $WORK/lua.tar.gz" | shasum -a 256 -c - >/dev/null
tar -xzf "$WORK/lua.tar.gz" -C "$WORK"
make -s -C "$WORK/lua-$VERSION" posix >/dev/null 2>&1
make -s -C "$WORK/lua-$VERSION" install INSTALL_TOP="$PREFIX" >/dev/null
"$PREFIX/bin/lua" -v
