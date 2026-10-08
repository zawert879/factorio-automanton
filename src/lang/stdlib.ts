// Типы встроенной библиотеки языка для проверки типов (src/lang/check.ts): ровно то, что умеет рантайм
// (src/lang/runtime/). Разбирается тем же парсером в режиме объявлений, вместе с automaton.d.ts.
// Массив, Map и Set — обычные обобщённые интерфейсы; T[] — это Array<T>.
export const STDLIB = `
interface Array<T> {
  length: number;
  [index: number]: T;
  push(...items: T[]): number;
  pop(): T | undefined;
  shift(): T | undefined;
  unshift(...items: T[]): number;
  slice(start?: number, end?: number): T[];
  splice(start: number, deleteCount?: number, ...items: T[]): T[];
  concat(...items: (T | T[])[]): T[];
  join(separator?: string): string;
  toString(): string;
  reverse(): T[];
  indexOf(value: T, fromIndex?: number): number;
  lastIndexOf(value: T, fromIndex?: number): number;
  includes(value: T, fromIndex?: number): boolean;
  fill(value: T, start?: number, end?: number): T[];
  at(index: number): T | undefined;
  flat(depth?: number): any[];
  sort(compare?: (a: T, b: T) => number): T[];
  forEach(fn: (value: T, index: number, array: T[]) => void): void;
  map<U>(fn: (value: T, index: number, array: T[]) => U): U[];
  filter(fn: (value: T, index: number, array: T[]) => unknown): T[];
  find(fn: (value: T, index: number, array: T[]) => unknown): T | undefined;
  findIndex(fn: (value: T, index: number, array: T[]) => unknown): number;
  findLast(fn: (value: T, index: number, array: T[]) => unknown): T | undefined;
  findLastIndex(fn: (value: T, index: number, array: T[]) => unknown): number;
  some(fn: (value: T, index: number, array: T[]) => unknown): boolean;
  every(fn: (value: T, index: number, array: T[]) => unknown): boolean;
  reduce(fn: (acc: T, value: T, index: number, array: T[]) => T): T;
  reduce<U>(fn: (acc: U, value: T, index: number, array: T[]) => U, initial: U): U;
  reduceRight(fn: (acc: T, value: T, index: number, array: T[]) => T): T;
  reduceRight<U>(fn: (acc: U, value: T, index: number, array: T[]) => U, initial: U): U;
  flatMap<U>(fn: (value: T, index: number, array: T[]) => U | U[]): U[];
}

interface String {
  length: number;
  [index: number]: string;
  charAt(index: number): string;
  charCodeAt(index: number): number;
  codePointAt(index: number): number | undefined;
  at(index: number): string | undefined;
  indexOf(search: string, fromIndex?: number): number;
  lastIndexOf(search: string, fromIndex?: number): number;
  includes(search: string, fromIndex?: number): boolean;
  startsWith(search: string, position?: number): boolean;
  endsWith(search: string, length?: number): boolean;
  slice(start?: number, end?: number): string;
  substring(start: number, end?: number): string;
  substr(start: number, length?: number): string;
  toUpperCase(): string;
  toLowerCase(): string;
  trim(): string;
  trimStart(): string;
  trimEnd(): string;
  split(separator: string, limit?: number): string[];
  repeat(count: number): string;
  padStart(length: number, fill?: string): string;
  padEnd(length: number, fill?: string): string;
  replace(search: string, replacement: string): string;
  replaceAll(search: string, replacement: string): string;
  concat(...strings: unknown[]): string;
  toString(): string;
  valueOf(): string;
  normalize(form?: string): string;
  localeCompare(other: string): number;
}

interface Number {
  toFixed(digits?: number): string;
  toString(radix?: number): string;
  toPrecision(precision?: number): string;
  valueOf(): number;
}

interface Boolean {
  toString(): string;
  valueOf(): boolean;
}

interface Map<K, V> {
  readonly size: number;
  get(key: K): V | undefined;
  set(key: K, value: V): Map<K, V>;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  keys(): K[];
  values(): V[];
  entries(): [K, V][];
  forEach(fn: (value: V, key: K, map: Map<K, V>) => void): void;
}

interface Set<T> {
  readonly size: number;
  add(value: T): Set<T>;
  has(value: T): boolean;
  delete(value: T): boolean;
  clear(): void;
  keys(): T[];
  values(): T[];
  entries(): [T, T][];
  forEach(fn: (value: T, key: T, set: Set<T>) => void): void;
}

declare class Error {
  constructor(message?: string);
  name: string;
  message: string;
  stack?: string;
}
declare class TypeError extends Error {
  constructor(message?: string);
}
declare class RangeError extends Error {
  constructor(message?: string);
}
declare class SyntaxError extends Error {
  constructor(message?: string);
}

declare const Math: {
  readonly PI: number;
  readonly E: number;
  readonly LN2: number;
  readonly LN10: number;
  readonly LOG2E: number;
  readonly LOG10E: number;
  readonly SQRT2: number;
  readonly SQRT1_2: number;
  abs(x: number): number;
  floor(x: number): number;
  ceil(x: number): number;
  round(x: number): number;
  trunc(x: number): number;
  sign(x: number): number;
  min(...values: number[]): number;
  max(...values: number[]): number;
  sqrt(x: number): number;
  cbrt(x: number): number;
  pow(x: number, y: number): number;
  exp(x: number): number;
  log(x: number): number;
  log2(x: number): number;
  log10(x: number): number;
  sin(x: number): number;
  cos(x: number): number;
  tan(x: number): number;
  asin(x: number): number;
  acos(x: number): number;
  atan(x: number): number;
  atan2(y: number, x: number): number;
  hypot(...values: number[]): number;
  random(): number;
};

declare const Object: {
  keys(o: object): string[];
  values(o: any): any[];
  entries(o: any): [string, any][];
  assign<T>(target: T, ...sources: any[]): T;
  fromEntries(entries: any): any;
  freeze<T>(o: T): T;
};

declare const Array: {
  isArray(value: unknown): boolean;
  from(source: any, map?: (value: any, index: number) => any): any[];
  of<T>(...items: T[]): T[];
};

declare const JSON: {
  stringify(value: unknown, replacer?: unknown, space?: number | string): string;
  parse(text: string): any;
};

declare const Number: {
  (value?: unknown): number;
  isInteger(value: unknown): boolean;
  isFinite(value: unknown): boolean;
  isNaN(value: unknown): boolean;
  parseInt(text: string, radix?: number): number;
  parseFloat(text: string): number;
  readonly MAX_SAFE_INTEGER: number;
  readonly MIN_SAFE_INTEGER: number;
  readonly EPSILON: number;
  readonly MAX_VALUE: number;
  readonly MIN_VALUE: number;
  readonly POSITIVE_INFINITY: number;
  readonly NEGATIVE_INFINITY: number;
  readonly NaN: number;
};

declare const String: {
  (value?: unknown): string;
  fromCharCode(...codes: number[]): string;
};

declare function Boolean(value?: unknown): boolean;
declare function parseInt(text: string, radix?: number): number;
declare function parseFloat(text: string): number;
declare function isNaN(value: number): boolean;
declare function isFinite(value: number): boolean;
declare const NaN: number;
declare const Infinity: number;
declare const undefined: undefined;
`
