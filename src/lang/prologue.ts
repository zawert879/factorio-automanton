// Пролог каждой скомпилированной программы — частые операции на чистом Lua.
// Получает рантайм (src/lang/runtime.ts) как аргумент чанка; окружение чанка пустое, поэтому
// всё, что нужно коду программы, — локальные переменные пролога.
//
// Протокол вызова: каждая функция программы — function(e, this, k, ...) где e — окружение замыкания,
// k — кадр для продолжения (nil — новый вызов). Возвращает значение или Y, кадр (пауза).
// Значения функций — таблицы {__f = номер прототипа, __e = окружение}.
// Кадр паузы любой функции хранит кадр вызванной (ребёнка) в [2] — цепочку можно обойти.
export const PROLOGUE = `local R = ...
local Y, Q, ERR, type = R.Y, R.Q, R.err, R.type
local GETX, SETX, IDXX, SETIDXX, LENX, ADDX, SX, METHOD, CALLX = R.getx, R.setx, R.idxx, R.setidxx, R.lenx, R.addx, R.sx, R.method, R.callx
local MAXS, MAXD = R.limits.string, R.limits.depth
local GETX, IDXX, LENX = R.getx, R.idxx, R.lenx
local PCALL, ERROR, FMOD, UNPACK, CAUGHT = R.pcall, R.error, R.fmod, R.unpack, R.caught
local H, HO, LIB, MATH = R.host, R.hostObjects, R.lib, R.math
local P = {}
-- Квант, глубина вызовов, вложенность синхронных вызовов: upvalue быстрее полей таблицы.
local QN, QD, QS, HARD = 0, 0, 0, Q.hard
-- Отладка (18.8): точки остановки машины (строка в кодировке модулей → true) и шаг до следующей строки.
-- BPON — включено ли что-то: без отладки проверка перед инструкцией — одно сравнение upvalue.
local BPON, BP, STEP = false, nil, false
local function BRK(l)
  if STEP or (BP and BP[l]) then
    Q.hit = l
    return true
  end
  return false
end
-- Номера возобновляемых прототипов (заполняет конец программы).
local RES = {}
local AM, AMR = R.arrayMethods, R.arrayMethodsResumable
local next = R.next
local function CALL(c, k, this, ...)
  local f = type(c) == "table" and c.__f
  if f then return P[f](c.__e, this, k, ...) end
  return CALLX(c, k, this, ...)
end
local function CALLS(c, this, ...)
  local f = type(c) == "table" and c.__f
  if f and not RES[f] then
    -- Короткая функция не приостанавливается: вызов напрямую.
    QS = QS + 1
    if QS > MAXD then ERR("stack-overflow") end
    local r = P[f](c.__e, this, nil, ...)
    QS = QS - 1
    return r
  end
  QS = QS + 1
  if QS > MAXD then ERR("stack-overflow") end
  local r, f = CALL(c, nil, this, ...)
  while r == Y do
    if QN < HARD then ERR("callback-too-long") end
    r, f = CALL(c, f, this)
  end
  QS = QS - 1
  return r
end
local function CALLM(o, name, k, ...)
  if type(o) == "table" then
    local v = o[name]
    if v ~= nil then return CALL(v, k, o, ...) end
    local cls = o.__cls
    if cls then
      local m = cls.__m[name]
      if m then return P[m.__f](m.__e, o, k, ...) end
    end
  end
  return METHOD(o, name, true)(o, k, ...)
end
local function CALLMS(o, name, ...)
  if type(o) == "table" then
    local v = o[name]
    if v ~= nil then return CALLS(v, o, ...) end
    local cls = o.__cls
    if cls then
      local m = cls.__m[name]
      if m then return CALLS(m, o, ...) end
    end
  end
  return METHOD(o, name, false)(o, nil, ...)
end
local function ALLOC(t)
  local a = Q.a + 1
  Q.a = a
  if a > Q.am then R.memory() end
  return t
end
local function NEW(cls, k, ...)
  local o
  if k then
    o = k.o
    k = k[2]
  else
    if type(cls) ~= "table" or cls.__k == nil then return R.newBuiltin(cls, ...) end
    o = ALLOC({__cls = cls})
  end
  local ctor = cls.__ctor
  if ctor then
    local r, f = P[ctor.__f](ctor.__e, o, k, ...)
    if r == Y then return Y, {nil, f, o = o} end
  end
  return o
end
local function NEWS(cls, ...)
  QS = QS + 1
  if QS > MAXD then ERR("stack-overflow") end
  local r, f = NEW(cls, nil, ...)
  while r == Y do
    if QN < HARD then ERR("callback-too-long") end
    r, f = NEW(cls, f)
  end
  QS = QS - 1
  return r
end
local function SUPERCTOR(cls, this, k, ...)
  local s = cls.__s
  if s.__builtin then return R.superBuiltin(s, this, ...) end
  local ctor = s.__ctor
  if ctor then return P[ctor.__f](ctor.__e, this, k, ...) end
end
local function SUPERCALL(cls, name, this, k, ...)
  local m = cls.__s.__m[name]
  if m then return P[m.__f](m.__e, this, k, ...) end
  return METHOD(this, name, true)(this, k, ...)
end
local function GET(o, key)
  if type(o) == "table" then
    local v = o[key]
    if v ~= nil then return v end
  end
  return GETX(o, key)
end
local function SET(o, key, v)
  if type(o) == "table" and o.__n == nil and o.__t == nil and o.__f == nil then
    o[key] = v
    return
  end
  SETX(o, key, v)
end
local function IDX(o, i)
  if type(i) == "number" and type(o) == "table" and o.__n then return o[i + 1] end
  return IDXX(o, i)
end
local function SETIDX(o, i, v)
  if type(i) == "number" and type(o) == "table" then
    local n = o.__n
    if n and i >= 0 and i < n and i % 1 == 0 then
      o[i + 1] = v
      return
    end
  end
  SETIDXX(o, i, v)
end
local function LEN(o)
  if type(o) == "table" then
    local n = o.__n
    if n then return n end
  end
  return LENX(o)
end
local function ADD(a, b)
  if type(a) == "number" and type(b) == "number" then return a + b end
  return ADDX(a, b)
end
local function S(x)
  if type(x) == "string" then return x end
  return SX(x)
end
local function CHK(s)
  local n = #s
  if n > MAXS then ERR("string-too-long") end
  Q.a = Q.a + n * 0.004
  return s
end
local function T(x)
  return x ~= nil and x ~= false and x ~= 0 and x ~= "" and x == x
end
local function DEPTH()
  QD = QD - 1
  ERR("stack-overflow")
end`

/** Конец чанка: прототипы и функции вызова — рантайму (методы высшего порядка, геттеры, колбэки игры). */
export const EPILOGUE = `return {
  P = P, call = CALL, calls = CALLS, callm = CALLM, callms = CALLMS, new = NEW,
  setBudget = function(n) QN, QD, QS = n, 0, 0 end,
  budget = function() return QN end,
  charge = function(n) QN = QN - n return QN end,
  sync = function() return QS end,
  setBreak = function(points, step) BP, STEP = points, step BPON = points ~= nil or step end,
}`
