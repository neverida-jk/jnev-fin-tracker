import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

function crc32(buf) {
  let c
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c
    }
    return t
  })())
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function makePng(size) {
  const bg = [15, 23, 42] // slate-900
  const coin = [199, 210, 254] // indigo-200
  const coinShadow = [79, 70, 229] // indigo-600

  const cx = size / 2
  const cy = size / 2
  const r = size * 0.32

  const raw = Buffer.alloc((size * 4 + 1) * size)
  let offset = 0
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0 // filter type: none
    for (let x = 0; x < size; x++) {
      const dx = x - cx
      const dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      let px = bg
      if (dist < r) px = coin
      else if (dist < r + size * 0.015) px = coinShadow
      raw[offset++] = px[0]
      raw[offset++] = px[1]
      raw[offset++] = px[2]
      raw[offset++] = 255
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const idat = deflateSync(raw)

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

writeFileSync('public/pwa-192x192.png', makePng(192))
writeFileSync('public/pwa-512x512.png', makePng(512))
console.log('Generated pwa-192x192.png and pwa-512x512.png')
