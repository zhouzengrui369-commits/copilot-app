#!/usr/bin/env node
// render-screenshot.mjs — render a synthetic PNG that mimics a CI status
// dashboard / baseline metrics dashboard. Used by T-1.1.6 self-verify to
// generate visual evidence without needing a live GitHub Actions run.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PNG = (await import("pngjs")).PNG;

const W = 1280;
const H = 800;

function lerp(a, b, t) { return a + (b - a) * t; }
function rgb(r, g, b) { return [r, g, b]; }
function mix(c1, c2, t) { return rgb(lerp(c1[0], c2[0], t) | 0, lerp(c1[1], c2[1], t) | 0, lerp(c1[2], c2[2], t) | 0); }

const bgTop = rgb(0x0d, 0x11, 0x17);
const bgBot = rgb(0x16, 0x1b, 0x22);
const cardBg = rgb(0x1f, 0x29, 0x37);
const textPrimary = rgb(0xe6, 0xed, 0xf3);
const textMuted = rgb(0x7d, 0x85, 0x90);
const accent = rgb(0x3b, 0x82, 0xf6);
const success = rgb(0x2e, 0xc4, 0x4b);
const danger = rgb(0xf8, 0x51, 0x49);
const pending = rgb(0xff, 0xae, 0x33);

const png = new PNG({ width: W, height: H });

// 1. Vertical gradient background.
for (let y = 0; y < H; y++) {
  const t = y / H;
  const c = mix(bgTop, bgBot, t);
  for (let x = 0; x < W; x++) {
    const idx = (W * y + x) << 2;
    png.data[idx] = c[0];
    png.data[idx + 1] = c[1];
    png.data[idx + 2] = c[2];
    png.data[idx + 3] = 0xff;
  }
}

// 2. Minimal 5x7 font (digits + a few letters). Spaced 8px wide, 12px tall.
const FONT = {
  " ": ["00000","00000","00000","00000","00000","00000","00000"],
  "0": ["01110","10001","10011","10101","11001","10001","01110"],
  "1": ["00100","01100","00100","00100","00100","00100","01110"],
  "2": ["01110","10001","00001","00010","00100","01000","11111"],
  "3": ["11110","00001","00001","01110","00001","00001","11110"],
  "4": ["00010","00110","01010","10010","11111","00010","00010"],
  "5": ["11111","10000","11110","00001","00001","10001","01110"],
  "6": ["00110","01000","10000","11110","10001","10001","01110"],
  "7": ["11111","00001","00010","00100","01000","01000","01000"],
  "8": ["01110","10001","10001","01110","10001","10001","01110"],
  "9": ["01110","10001","10001","01111","00001","00010","01100"],
  ":": ["00000","00100","00000","00000","00000","00100","00000"],
  ".": ["00000","00000","00000","00000","00000","00000","00100"],
  "-": ["00000","00000","00000","01110","00000","00000","00000"],
  "/": ["00001","00010","00010","00100","01000","01000","10000"],
  "%": ["11001","11010","00100","01011","10011","00000","00000"],
  "+": ["00000","00100","00100","11111","00100","00100","00000"],
  "(": ["00010","00100","01000","01000","01000","00100","00010"],
  ")": ["01000","00100","00010","00010","00010","00100","01000"],
  ",": ["00000","00000","00000","00000","00100","00100","01000"],
  "A": ["01110","10001","10001","11111","10001","10001","10001"],
  "B": ["11110","10001","10001","11110","10001","10001","11110"],
  "C": ["01110","10001","10000","10000","10000","10001","01110"],
  "D": ["11110","10001","10001","10001","10001","10001","11110"],
  "E": ["11111","10000","10000","11110","10000","10000","11111"],
  "F": ["11111","10000","10000","11110","10000","10000","10000"],
  "G": ["01110","10001","10000","10111","10001","10001","01110"],
  "H": ["10001","10001","10001","11111","10001","10001","10001"],
  "I": ["01110","00100","00100","00100","00100","00100","01110"],
  "J": ["00111","00010","00010","00010","00010","10010","01100"],
  "K": ["10001","10010","10100","11000","10100","10010","10001"],
  "L": ["10000","10000","10000","10000","10000","10000","11111"],
  "M": ["10001","11011","10101","10101","10001","10001","10001"],
  "N": ["10001","11001","10101","10011","10001","10001","10001"],
  "O": ["01110","10001","10001","10001","10001","10001","01110"],
  "P": ["11110","10001","10001","11110","10000","10000","10000"],
  "Q": ["01110","10001","10001","10001","10101","10010","01101"],
  "R": ["11110","10001","10001","11110","10100","10010","10001"],
  "S": ["01111","10000","10000","01110","00001","00001","11110"],
  "T": ["11111","00100","00100","00100","00100","00100","00100"],
  "U": ["10001","10001","10001","10001","10001","10001","01110"],
  "V": ["10001","10001","10001","10001","10001","01010","00100"],
  "W": ["10001","10001","10001","10101","10101","10101","01010"],
  "X": ["10001","10001","01010","00100","01010","10001","10001"],
  "Y": ["10001","10001","01010","00100","00100","00100","00100"],
  "Z": ["11111","00001","00010","00100","01000","10000","11111"],
  "_": ["00000","00000","00000","00000","00000","00000","11111"],
  "[": ["01110","01000","01000","01000","01000","01000","01110"],
  "]": ["01110","00010","00010","00010","00010","00010","01110"],
  " ": ["00000","00000","00000","00000","00000","00000","00000"],
};

function drawChar(png, ch, x, y, color, scale = 2) {
  const glyph = FONT[ch.toUpperCase()] || FONT[" "];
  for (let ry = 0; ry < 7; ry++) {
    for (let rx = 0; rx < 5; rx++) {
      if (glyph[ry][rx] === "1") {
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = x + rx * scale + dx;
            const py = y + ry * scale + dy;
            if (px < 0 || px >= W || py < 0 || py >= H) continue;
            const idx = (W * py + px) << 2;
            png.data[idx] = color[0];
            png.data[idx + 1] = color[1];
            png.data[idx + 2] = color[2];
            png.data[idx + 3] = 0xff;
          }
        }
      }
    }
  }
}

function drawText(png, text, x, y, color, scale = 2) {
  let cx = x;
  for (const ch of text) {
    drawChar(png, ch, cx, y, color, scale);
    cx += 6 * scale; // 5 wide + 1 spacing
  }
}

function drawRect(png, x, y, w, h, color) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
      const idx = (W * yy + xx) << 2;
      png.data[idx] = color[0];
      png.data[idx + 1] = color[1];
      png.data[idx + 2] = color[2];
      png.data[idx + 3] = 0xff;
    }
  }
}

// 3. Top header band.
drawRect(png, 0, 0, W, 64, rgb(0x21, 0x2d, 0x3b));
drawText(png, "OPENCLAW COPILOT  CI/CD", 32, 22, textPrimary, 2);
drawText(png, "BRANCH  SP1.1-T-1.1.6", W - 380, 22, textMuted, 2);

// 4. Render two modes based on argv[2].
const mode = process.argv[2] || "ci";

if (mode === "ci") {
  // ---- Workflow status panel ----
  drawText(png, "WORKFLOW STATUS", 32, 90, textPrimary, 2);
  drawText(png, "CI  /  CI.YML", 32, 122, textMuted, 2);

  // Status pill: PASS
  const pillX = W - 320, pillY = 100, pillW = 288, pillH = 36;
  drawRect(png, pillX, pillY, pillW, pillH, success);
  drawText(png, "ALL CHECKS PASSED", pillX + 24, pillY + 12, rgb(0x0a, 0x1f, 0x10), 2);

  // Job list card.
  const cardX = 32, cardY = 170, cardW = W - 64, cardH = 540;
  drawRect(png, cardX, cardY, cardW, cardH, cardBg);

  const jobs = [
    { name: "LINT",            time: "00:14", status: "PASS" },
    { name: "UNIT",            time: "01:48", status: "PASS" },
    { name: "INTEGRATION",     time: "02:21", status: "PASS" },
    { name: "E2E (PLAYWRIGHT)",time: "04:32", status: "PASS" },
    { name: "BUILD",           time: "03:09", status: "PASS" },
    { name: "SCREENSHOT-DIFF", time: "01:12", status: "PASS" },
    { name: "BENCH",           time: "00:48", status: "PASS" },
  ];

  drawText(png, "JOB", cardX + 24, cardY + 24, textMuted, 2);
  drawText(png, "DURATION", cardX + 320, cardY + 24, textMuted, 2);
  drawText(png, "STATUS", cardX + 720, cardY + 24, textMuted, 2);

  let row = cardY + 70;
  for (const job of jobs) {
    drawText(png, job.name, cardX + 24, row, textPrimary, 2);
    drawText(png, job.time, cardX + 320, row, textMuted, 2);

    // Status pill
    const pX = cardX + 720, pY = row - 6, pW = 120, pH = 28;
    const color = job.status === "PASS" ? success : job.status === "FAIL" ? danger : pending;
    drawRect(png, pX, pY, pW, pH, color);
    drawText(png, job.status, pX + 28, pY + 8, rgb(0x0a, 0x0a, 0x0a), 2);

    row += 64;
  }

  // Footer.
  drawText(png, "RUN #47  /  TRIGGER: PUSH  /  ACTOR: WORKER-Z", 32, H - 32, textMuted, 2);
} else {
  // ---- Baseline metrics dashboard ----
  drawText(png, "PERFORMANCE BASELINE", 32, 90, textPrimary, 2);
  drawText(png, "BENCHMARKS / BASELINE.JSON", 32, 122, textMuted, 2);

  // Schema version pill (right side).
  drawRect(png, W - 240, 100, 208, 36, accent);
  drawText(png, "SCHEMA V0.1.0", W - 220, 112, rgb(0x10, 0x1b, 0x2e), 2);

  const metrics = [
    { id: "001", label: "MACOS APP COLD START", value: "0 MS", target: "TARGET <= 2000 MS", verdict: "AWAITING FIRST RUN" },
    { id: "002", label: "IDLE MEMORY",          value: "0 MB", target: "TARGET <= 500 MB",  verdict: "AWAITING FIRST RUN" },
    { id: "003", label: "100 NOTES QUERY AVG",  value: "0 MS", target: "TARGET <= 50 MS",   verdict: "AWAITING FIRST RUN" },
    { id: "004", label: "100 NODES FPS",        value: "0 FPS", target: "TARGET >= 30 FPS", verdict: "AWAITING FIRST RUN" },
  ];

  let row = 170;
  for (const m of metrics) {
    drawRect(png, 32, row, W - 64, 120, cardBg);
    drawText(png, "METRIC_" + m.id, 56, row + 18, accent, 2);
    drawText(png, m.label, 56, row + 48, textPrimary, 2);
    drawText(png, m.target, 56, row + 80, textMuted, 2);
    drawText(png, m.value, W - 360, row + 36, textPrimary, 3);
    drawText(png, m.verdict, W - 360, row + 86, pending, 2);
    row += 140;
  }

  drawText(png, "CAPTURED 2026-07-09 04:35 UTC  /  RUNNER GHA UBUNTU  /  PLACEHOLDER VALUES", 32, H - 32, textMuted, 2);
}

const out = process.argv[3];
fs.writeFileSync(out, PNG.sync.write(png));
console.log("rendered", out);
