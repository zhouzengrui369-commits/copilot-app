#!/usr/bin/env node
/**
 * Generate a multi-resolution Windows .ico file (256/128/48/16) from a single
 * solid-color RGBA buffer. Each size is encoded as PNG inside the .ico
 * container — electron-builder accepts PNG-in-ICO since v22.
 *
 * Used by Sprint 1.3 T-1.3.2 (worker γ) for the unsigned Win builds.
 * A real branded icon is queued for Sprint 1.4.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const OUT = resolve(process.cwd(), 'build/icon.ico');
mkdirSync(dirname(OUT), { recursive: true });

const SIZES = [256, 128, 48, 16];
// njx brand: deep blue gradient on transparent. RGBA per pixel.
function pixelAt(x, y, size) {
  // Simple radial-ish gradient + alpha-corner rounding for visual sanity.
  const cx = size / 2;
  const cy = size / 2;
  const dx = (x - cx) / cx;
  const dy = (y - cy) / cy;
  const r = Math.sqrt(dx * dx + dy * dy);
  if (r > 1.0) return [0, 0, 0, 0]; // outside circle
  // Color: dark navy → bright blue.
  const t = Math.max(0, Math.min(1, 1 - r));
  const R = Math.round(20 + (90 - 20) * t);
  const G = Math.round(40 + (160 - 40) * t);
  const B = Math.round(110 + (240 - 110) * t);
  const A = 255;
  return [R, G, B, A];
}

function makePng(size) {
  // Build raw RGBA buffer.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size); // +1 byte filter per row
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type: None
    for (let x = 0; x < size; x++) {
      const [R, G, B, A] = pixelAt(x, y, size);
      const off = y * (stride + 1) + 1 + x * 4;
      raw[off] = R;
      raw[off + 1] = G;
      raw[off + 2] = B;
      raw[off + 3] = A;
    }
  }
  const compressed = deflateSync(raw);

  // PNG signature
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c = c ^ buf[i];
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
    }
    return ~c >>> 0;
  }

  // IHDR: width(4) height(4) bitdepth(1) colortype(1=grayscale+alpha for our 8bit rgba) ... use 6=RGBA
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function buildIco(pngs, sizes) {
  // ICONDIR (6) + ICONDIRENTRY (16 * N) + PNG data
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);       // reserved
  dir.writeUInt16LE(1, 2);       // type: 1 = icon
  dir.writeUInt16LE(pngs.length, 4); // count

  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (let i = 0; i < pngs.length; i++) {
    const size = sizes[i];
    const data = pngs[i];
    const e = Buffer.alloc(16);
    e[0] = size === 256 ? 0 : size;  // width (0 = 256)
    e[1] = size === 256 ? 0 : size;  // height
    e[2] = 0;                        // color palette
    e[3] = 0;                        // reserved
    e.writeUInt16LE(1, 4);           // color planes
    e.writeUInt16LE(32, 6);          // bits per pixel
    e.writeUInt32LE(data.length, 8); // image size
    e.writeUInt32LE(offset, 12);     // offset from start of file
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([dir, ...entries, ...pngs]);
}

const pngs = SIZES.map(makePng);
const ico = buildIco(pngs, SIZES);
writeFileSync(OUT, ico);
console.log(`✓ wrote ${OUT} (${ico.length} bytes, ${SIZES.join('/')} PNG-in-ICO)`);
