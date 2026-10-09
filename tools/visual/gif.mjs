// Серия PNG-кадров → GIF (как в tools/docs/record.mjs): палитра по выборке кадров, неизменившиеся пиксели —
// прозрачные, так GIF хранит почти только движение.
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import gifenc from "gifenc"
import { PNG } from "pngjs"

const { GIFEncoder, quantize, applyPalette } = gifenc

/** Кадры папки (по имени) в GIF; delay — мс на кадр. Итог — размер в байтах. */
export function framesToGif(dir, target, delay) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort()
  if (files.length === 0) return 0
  const frames = files.map((f) => PNG.sync.read(readFileSync(join(dir, f))))
  const { width, height } = frames[0]
  const step = Math.max(1, Math.floor(frames.length / 8))
  const sample = []
  for (let i = 0; i < frames.length; i += step) sample.push(frames[i].data)
  const pooled = new Uint8Array(sample.reduce((n, d) => n + d.length, 0))
  let offset = 0
  for (const d of sample) {
    pooled.set(d, offset)
    offset += d.length
  }
  const palette = quantize(pooled, 255, { format: "rgb565" })
  const transparent = palette.length
  const fullPalette = [...palette, [0, 0, 0]]
  const gif = GIFEncoder()
  let previous
  for (const frame of frames) {
    const index = applyPalette(frame.data, palette, "rgb565")
    let out = index
    if (previous !== undefined) {
      out = new Uint8Array(index.length)
      for (let i = 0; i < index.length; i++) out[i] = index[i] === previous[i] ? transparent : index[i]
    }
    gif.writeFrame(out, width, height, { palette: fullPalette, delay, transparent: previous !== undefined, transparentIndex: transparent, dispose: 1 })
    previous = index
  }
  gif.finish()
  writeFileSync(target, gif.bytes())
  return gif.bytes().length
}
