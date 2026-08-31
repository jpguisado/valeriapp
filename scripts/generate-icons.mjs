/**
 * Renders the app icons as PNGs with no image dependency: a navy square with
 * a light "V", plus a maskable variant with the safe-zone padding and a
 * monochrome badge for the notification tray.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT = join(process.cwd(), 'public', 'icons')
mkdirSync(OUT, { recursive: true })

const NAVY = [11, 21, 38, 255]
const BLUE = [122, 162, 255, 255]
const WHITE = [255, 255, 255, 255]
const CLEAR = [0, 0, 0, 0]

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const offset = y * (size * 4 + 1) + 1 + x * 4
      const colour = pixels[y * size + x]
      raw[offset] = colour[0]
      raw[offset + 1] = colour[1]
      raw[offset + 2] = colour[2]
      raw[offset + 3] = colour[3]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Distance from a point to a segment, used to draw the strokes of the V. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy || 1
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

function blend(base, colour, alpha) {
  if (alpha <= 0) return base
  if (alpha >= 1) return colour
  return [
    Math.round(base[0] + (colour[0] - base[0]) * alpha),
    Math.round(base[1] + (colour[1] - base[1]) * alpha),
    Math.round(base[2] + (colour[2] - base[2]) * alpha),
    Math.max(base[3], Math.round(colour[3] * alpha)),
  ]
}

function render(size, { background, foreground, scale, rounded }) {
  const pixels = new Array(size * size)
  const radius = size * 0.22
  const inset = size * (1 - scale) * 0.5
  const span = size * scale

  // The V, drawn as two thick strokes with a soft antialiased edge.
  const ax = inset + span * 0.2
  const ay = inset + span * 0.24
  const mx = inset + span * 0.5
  const my = inset + span * 0.78
  const bx = inset + span * 0.8
  const by = inset + span * 0.24
  const stroke = span * 0.115

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let colour = CLEAR
      if (background) {
        let inside = true
        if (rounded) {
          const cx = Math.min(Math.max(x, radius), size - radius)
          const cy = Math.min(Math.max(y, radius), size - radius)
          inside = Math.hypot(x - cx, y - cy) <= radius
        }
        colour = inside ? background : CLEAR
      }

      const distance = Math.min(
        distanceToSegment(x + 0.5, y + 0.5, ax, ay, mx, my),
        distanceToSegment(x + 0.5, y + 0.5, mx, my, bx, by),
      )
      const alpha = Math.max(0, Math.min(1, (stroke - distance) / 1.5 + 0.5))
      pixels[y * size + x] = blend(colour, foreground, alpha)
    }
  }
  return pixels
}

const targets = [
  ['icon-192.png', 192, { background: NAVY, foreground: BLUE, scale: 0.78, rounded: true }],
  ['icon-512.png', 512, { background: NAVY, foreground: BLUE, scale: 0.78, rounded: true }],
  ['icon-maskable-512.png', 512, { background: NAVY, foreground: BLUE, scale: 0.56, rounded: false }],
  ['badge-96.png', 96, { background: null, foreground: WHITE, scale: 0.9, rounded: false }],
  ['favicon-64.png', 64, { background: NAVY, foreground: BLUE, scale: 0.78, rounded: true }],
]

for (const [name, size, options] of targets) {
  writeFileSync(join(OUT, name), encodePng(size, render(size, options)))
  console.log(`icons/${name}`)
}
