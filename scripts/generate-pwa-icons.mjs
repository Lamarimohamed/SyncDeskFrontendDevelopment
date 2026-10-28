// Generates the PWA icon set (public/icons/*.png) without external dependencies.
// PNG encoding: RGBA, filter 0 scanlines, zlib deflate, CRC32 chunk checksums.
// Art: rounded blue square with a white two-arrow "sync" glyph.
// Usage: node scripts/generate-pwa-icons.mjs
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(projectRoot, 'public', 'icons')

const BG = [37, 99, 235] // #2563eb, matches the app theme color
const FG = [255, 255, 255]

const crcTable = new Int32Array(256)
for (let n = 0; n < 256; n += 1) {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c
}

const crc32 = (bytes) => {
  let crc = -1
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

const chunk = (type, data) => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, checksum])
}

const encodePng = (width, height, rgba) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', (() => {
      const ihdr = Buffer.alloc(13)
      ihdr.writeUInt32BE(width, 0)
      ihdr.writeUInt32BE(height, 4)
      ihdr[8] = 8 // bit depth
      ihdr[9] = 6 // color type RGBA
      return ihdr
    })()),
    chunk('IDAT', deflateSync(Buffer.from(rgba), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])

const inRoundedSquare = (u, v, half, radius) => {
  const ax = Math.abs(u)
  const av = Math.abs(v)
  if (ax > half || av > half) return false
  const inner = half - radius
  if (ax <= inner || av <= inner) return true
  const dx = ax - inner
  const dy = av - inner
  return dx * dx + dy * dy <= radius * radius
}

const inRing = (u, v, radius, thickness) => Math.abs(Math.hypot(u, v) - radius) <= thickness

const angleDeg = (u, v) => (Math.atan2(v, u) * 180) / Math.PI

const angularGap = (u, v, centers) => {
  const angle = ((angleDeg(u, v) % 360) + 360) % 360
  return centers.some((center) => {
    const delta = Math.abs(angle - center)
    return Math.min(delta, 360 - delta) < 17
  })
}

const inTriangle = (px, py, [ax, ay], [bx, by], [cx, cy]) => {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
  const d2 = (px - cx) * (ay - by) - (ax - bx) * (py - cy)
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

// Arrowheads sit at the two ring gaps (45° and 225°), pointing along the arc.
const TRIANGLE_A = [
  [0.44, 0.26],
  [0.16, 0.44],
  [0.14, 0.14],
]
const TRIANGLE_B = TRIANGLE_A.map(([x, y]) => [-x, -y])
const GAPS = [45, 225]

/** Returns [r, g, b, a] (0-255, straight alpha) for one sample point in unit space. */
const sample = (u, v, maskable) => {
  const scale = maskable ? 0.74 : 1
  const gu = u / scale
  const gv = (v - (maskable ? 0 : 0.02)) / scale
  const glyph =
    (inRing(gu, gv, 0.4, 0.066) && !angularGap(gu, gv, GAPS)) ||
    inTriangle(gu, gv, ...TRIANGLE_A) ||
    inTriangle(gu, gv, ...TRIANGLE_B)
  if (glyph) return FG
  const half = maskable ? 1 : 0.92
  const radius = maskable ? 0 : 0.22
  if (inRoundedSquare(u, v, half, radius)) return BG
  return null
}

const render = (size, maskable) => {
  const rgba = Buffer.alloc(size * (size * 4 + 1))
  const subs = [-0.25, 0.25]
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sr = 0
      let sg = 0
      let sb = 0
      let sa = 0
      for (const dy of subs) {
        for (const dx of subs) {
          const u = ((x + 0.5 + dx) / size) * 2 - 1
          const v = ((y + 0.5 + dy) / size) * 2 - 1
          const color = sample(u, v, maskable)
          if (color) {
            sr += color[0]
            sg += color[1]
            sb += color[2]
            sa += 1
          }
        }
      }
      const offset = y * (size * 4 + 1) + 1 + x * 4 // +1 skips the per-scanline filter byte
      if (sa === 0) {
        rgba[offset] = 0
        rgba[offset + 1] = 0
        rgba[offset + 2] = 0
        rgba[offset + 3] = 0
      } else {
        rgba[offset] = Math.round(sr / sa)
        rgba[offset + 1] = Math.round(sg / sa)
        rgba[offset + 2] = Math.round(sb / sa)
        rgba[offset + 3] = Math.round((sa / 4) * 255)
      }
    }
  }
  return encodePng(size, size, rgba)
}

mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'icon-192.png'), render(192, false))
writeFileSync(resolve(outDir, 'icon-512.png'), render(512, false))
writeFileSync(resolve(outDir, 'icon-maskable-512.png'), render(512, true))
console.log(`wrote icon-192.png, icon-512.png, icon-maskable-512.png to ${outDir}`)
