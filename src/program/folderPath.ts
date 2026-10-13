// Путь к папке для VS Code в папке данных игры (25.1). Мод не знает систему игрока — путь для той, что выбрана
// в окне «VS Code».

export type FolderOs = "windows" | "macos" | "linux"

export const FOLDER_OS: FolderOs[] = ["windows", "macos", "linux"]

/** Папка данных игры при обычной установке (Steam, сайт); версия из zip хранит данные в своей папке. */
const DATA_DIR: Record<FolderOs, string> = {
  windows: "%APPDATA%\\Factorio",
  macos: "~/Library/Application Support/factorio",
  linux: "~/.factorio",
}

/** Полный путь папки `dir` из script-output (automaton/map-1/player) — для вставки в окно «Открыть папку». */
export function folderPath(os: FolderOs, dir: string): string {
  const path = `${DATA_DIR[os]}/script-output/${dir}`
  return os === "windows" ? string.gsub(path, "/", "\\")[0] : path
}
