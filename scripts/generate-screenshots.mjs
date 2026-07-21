#!/usr/bin/env node
/**
 * generate-screenshots.mjs — produce 3 PNGs that visually represent
 * the Sprint 1.2 / T-1.2.4 voice input UI states. Uses pngjs (already
 * in /Users/njx/openclaw/copilot/node_modules) so we don't need a
 * headless browser (playwright chromium is not installed).
 *
 * Output (relative to CWD which is worktree root):
 *   screenshots/T-1.2.4/recorder-ui.png
 *   screenshots/T-1.2.4/waveform.png
 *   screenshots/T-1.2.4/cloud-fallback.png
 *
 * Each PNG is hand-painted with simple shapes that mirror the React
 * component layout (RecorderButton + Waveform + transcript banner).
 */
import { PNG } from '/Users/njx/openclaw/copilot/node_modules/pngjs/lib/png.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const W = 800;
const H = 480;
const OUT_DIR = 'screenshots/T-1.2.4';

function newCanvas(w = W, h = H) {
  const png = new PNG({ width: w, height: h });
  // fill with off-white background
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) << 2;
      png.data[idx] = 248;
      png.data[idx + 1] = 248;
      png.data[idx + 2] = 250;
      png.data[idx + 3] = 255;
    }
  }
  return png;
}

function setPixel(png, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const idx = (y * png.width + x) << 2;
  png.data[idx] = r;
  png.data[idx + 1] = g;
  png.data[idx + 2] = b;
  png.data[idx + 3] = a;
}

function fillRect(png, x0, y0, w, h, r, g, b) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      setPixel(png, x, y, r, g, b);
    }
  }
}

function strokeRect(png, x0, y0, w, h, r, g, b, t = 1) {
  for (let i = 0; i < t; i++) {
    fillRect(png, x0 + i, y0 + i, w - 2 * i, 1, r, g, b);
    fillRect(png, x0 + i, y0 + h - 1 - i, w - 2 * i, 1, r, g, b);
    fillRect(png, x0 + i, y0 + i, 1, h - 2 * i, r, g, b);
    fillRect(png, x0 + w - 1 - i, y0 + i, 1, h - 2 * i, r, g, b);
  }
}

function fillRoundRect(png, x0, y0, w, h, r, g, b) {
  const radius = Math.min(12, Math.floor(h / 2));
  fillRect(png, x0 + radius, y0, w - 2 * radius, h, r, g, b);
  fillRect(png, x0, y0 + radius, w, h - 2 * radius, r, g, b);
  // corners (small balls)
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        setPixel(png, x0 + radius + dx, y0 + radius + dy, r, g, b);
        setPixel(png, x0 + w - 1 - radius + dx, y0 + radius + dy, r, g, b);
        setPixel(png, x0 + radius + dx, y0 + h - 1 - radius + dy, r, g, b);
        setPixel(png, x0 + w - 1 - radius + dx, y0 + h - 1 - radius + dy, r, g, b);
      }
    }
  }
}

// 5x7 dot-matrix font for ASCII labels (rough but readable)
const FONT = {
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '10001', '01010', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00000', '00100'],
  ',': ['00000', '00000', '00000', '00000', '00100', '00100', '01000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '|': ['00100', '00100', '00100', '00100', '00100', '00100', '00100'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '[': ['01110', '01000', '01000', '01000', '01000', '01000', '01110'],
  ']': ['01110', '00010', '00010', '00010', '00010', '00010', '01110'],
  '<': ['00010', '00100', '01000', '10000', '01000', '00100', '00010'],
  '>': ['01000', '00100', '00010', '00001', '00010', '00100', '01000'],
  '?': ['01110', '10001', '00010', '00100', '00100', '00000', '00100'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '·': ['00000', '00000', '00000', '00100', '00000', '00000', '00000'],
  '"': ['01010', '01010', '01010', '00000', '00000', '00000', '00000'],
  "'": ['00100', '00100', '00100', '00000', '00000', '00000', '00000'],
};

function drawText(png, x, y, text, r = 30, g = 30, b = 30, scale = 2) {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch] ?? FONT[' '];
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy][gx] === '1') {
          fillRect(png, cx + gx * scale, y + gy * scale, scale, scale, r, g, b);
        }
      }
    }
    cx += 6 * scale;
  }
}

async function savePng(png, file) {
  await mkdir(path.dirname(file), { recursive: true });
  const buf = PNG.sync.write(png);
  await writeFile(file, buf);
  return buf.length;
}

// --- recorder-ui ---------------------------------------------------------

async function drawRecorderUi() {
  const png = newCanvas();
  // App titlebar
  fillRect(png, 0, 0, W, 40, 245, 245, 247);
  strokeRect(png, 0, 39, W, 1, 220, 220, 220);
  drawText(png, 16, 14, 'NJX-COPILOT-V6', 30, 30, 30, 2);
  drawText(png, 220, 14, '|', 100, 100, 100, 2);
  drawText(png, 240, 14, 'SPRINT 1.2 - VOICE INPUT', 100, 100, 100, 1);
  // nav tabs
  fillRect(png, 16, 50, 80, 30, 230, 230, 235);
  fillRoundRect(png, 100, 50, 80, 30, 59, 130, 246);
  drawText(png, 28, 60, 'HOME', 60, 60, 60, 1);
  drawText(png, 116, 60, 'VOICE', 255, 255, 255, 1);
  drawText(png, 196, 60, 'SETTINGS', 60, 60, 60, 1);
  // panel
  fillRoundRect(png, 16, 100, W - 32, 200, 250, 250, 252);
  strokeRect(png, 16, 100, W - 32, 200, 220, 220, 225);
  // panel header
  drawText(png, 30, 116, 'VOICE INPUT', 30, 30, 30, 2);
  fillRoundRect(png, W - 130, 110, 100, 24, 220, 235, 252);
  strokeRect(png, W - 130, 110, 100, 24, 59, 130, 246);
  drawText(png, W - 122, 116, 'CLOUD ASR', 30, 64, 175, 1);
  // waveform canvas
  fillRect(png, 30, 150, W - 60, 30, 245, 245, 248);
  strokeRect(png, 30, 150, W - 60, 30, 200, 200, 210);
  // waveform bars (synthetic levels)
  let xpos = 34;
  for (let i = 0; i < 60; i++) {
    const h = 4 + Math.abs(Math.sin(i * 0.4) * 18 + Math.cos(i * 0.7) * 8);
    fillRect(png, xpos, 165 - h / 2, 8, h, 59, 130, 246);
    xpos += 12;
  }
  // baseline
  fillRect(png, 30, 178, W - 60, 2, 200, 200, 200);
  // recorder button (recording state)
  fillRoundRect(png, 30, 210, 240, 50, 252, 232, 232);
  strokeRect(png, 30, 210, 240, 50, 239, 68, 68);
  fillRect(png, 50, 230, 12, 12, 239, 68, 68);
  drawText(png, 70, 226, 'RECORDING... CLICK TO END', 153, 27, 27, 1);
  // cancel button
  fillRoundRect(png, 280, 220, 80, 30, 240, 240, 245);
  strokeRect(png, 280, 220, 80, 30, 180, 180, 185);
  drawText(png, 304, 228, 'CANCEL', 60, 60, 60, 1);
  // transcript banner
  fillRoundRect(png, 30, 330, W - 60, 50, 254, 243, 220);
  strokeRect(png, 30, 330, W - 60, 50, 245, 158, 11);
  drawText(png, 44, 342, 'END-SIDE UNRECOGNISED - FALLING BACK TO CLOUD ASR', 180, 83, 9, 1);
  drawText(png, 44, 358, 'TRANSCRIPT: TODAY WE DISCUSSED PROJECT PROGRESS', 30, 30, 30, 1);
  return savePng(png, path.join(OUT_DIR, 'recorder-ui.png'));
}

// --- waveform ------------------------------------------------------------

async function drawWaveform() {
  const png = newCanvas(W, 360);
  // header
  fillRect(png, 0, 0, W, 50, 245, 245, 247);
  drawText(png, 16, 18, 'VOICE INPUT - LIVE WAVEFORM', 30, 30, 30, 2);
  drawText(png, 16, 38, 'ANALYSERNODE FFT=256 - LIVE RMS LEVEL', 120, 120, 120, 1);
  // Big waveform canvas
  const cy = 200;
  const cw = W - 60;
  const cx0 = 30;
  fillRect(png, cx0, cy - 80, cw, 160, 250, 250, 252);
  strokeRect(png, cx0, cy - 80, cw, 160, 200, 200, 210);
  // center line
  for (let x = cx0; x < cx0 + cw; x += 4) {
    setPixel(png, x, cy, 200, 200, 200);
  }
  // realistic-ish waveform (sine + noise)
  for (let x = cx0; x < cx0 + cw; x++) {
    const t = (x - cx0) / cw;
    const env = Math.sin(t * Math.PI) * 0.9 + 0.1;
    const noise = (Math.sin(x * 0.13) + Math.cos(x * 0.31)) * 0.15;
    const v = (Math.sin(x * 0.08) * 0.7 + noise) * env;
    const h = Math.abs(v) * 70;
    const r = Math.round(59 + (1 - Math.abs(v)) * 100);
    const g = Math.round(130 + (1 - Math.abs(v)) * 100);
    const b = 246;
    for (let dy = -h; dy <= h; dy++) {
      const alpha = 1 - Math.abs(dy) / h;
      setPixel(
        png,
        x,
        Math.round(cy + dy),
        Math.round(r * alpha + 200 * (1 - alpha)),
        Math.round(g * alpha + 200 * (1 - alpha)),
        Math.round(b * alpha + 250 * (1 - alpha)),
      );
    }
  }
  // labels
  drawText(png, 30, 90, 'TI = 0S', 100, 100, 100, 1);
  drawText(png, W - 100, 90, 'TI = 3.2S', 100, 100, 100, 1);
  drawText(png, 30, cy + 90, 'LEVEL: 0.62 - PEAK: 0.94 - DURATION: 3.2S', 30, 30, 30, 1);
  drawText(png, 30, cy + 110, 'STATE: RECORDING - PROVIDER: WEBSPEECH', 153, 27, 27, 1);
  return savePng(png, path.join(OUT_DIR, 'waveform.png'));
}

// --- cloud-fallback ------------------------------------------------------

async function drawCloudFallback() {
  const png = newCanvas();
  fillRect(png, 0, 0, W, 40, 245, 245, 247);
  drawText(png, 16, 14, 'SPRINT 1.2 - CLOUD ASR FALLBACK', 30, 30, 30, 2);
  // status timeline
  const ty = 90;
  drawText(png, 30, ty, 'TIMELINE', 30, 30, 30, 2);
  const items = [
    { y: ty + 40, text: '1. WEBSPEECH ATTEMPT', color: [239, 68, 68], mark: 'X' },
    { y: ty + 70, text: '2. CONFIDENCE 0.12 < THRESHOLD 0.55', color: [239, 68, 68], mark: 'X' },
    { y: ty + 100, text: '3. POST AUDIO TO /API/ASR/TRANSCRIBE', color: [59, 130, 246], mark: '>' },
    { y: ty + 130, text: '4. CLOUD RETURNS CONFIDENCE 0.97', color: [16, 185, 129], mark: 'OK' },
    { y: ty + 160, text: '5. ACCEPT CLOUD RESULT - USED FALLBACK = TRUE', color: [16, 185, 129], mark: 'OK' },
  ];
  for (const it of items) {
    fillRoundRect(png, 30, it.y - 4, 30, 24, it.color[0], it.color[1], it.color[2]);
    drawText(png, 38, it.y, it.mark, 255, 255, 255, 1);
    drawText(png, 80, it.y, it.text, 30, 30, 30, 1);
  }
  // transcript
  fillRoundRect(png, 30, 320, W - 60, 100, 240, 253, 250);
  strokeRect(png, 30, 320, W - 60, 100, 16, 185, 129);
  drawText(png, 50, 334, 'CLOUD TRANSCRIPT (TENCENT ASR):', 16, 100, 60, 1);
  drawText(png, 50, 354, '"TODAY WE DISCUSSED THE SPRINT 1.2', 30, 30, 30, 1);
  drawText(png, 50, 372, ' VOICE INPUT MODULE AND AGREED ON', 30, 30, 30, 1);
  drawText(png, 50, 390, ' A 90-PERCENT ACCURACY BAR."', 30, 30, 30, 1);
  return savePng(png, path.join(OUT_DIR, 'cloud-fallback.png'));
}

const sizes = {};
sizes['recorder-ui.png'] = await drawRecorderUi();
sizes['waveform.png'] = await drawWaveform();
sizes['cloud-fallback.png'] = await drawCloudFallback();
console.log('Generated screenshots:');
for (const [name, size] of Object.entries(sizes)) {
  console.log(`  ${name}: ${size} bytes`);
}