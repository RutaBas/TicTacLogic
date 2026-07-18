/* tools/generate-icons.js — render the hand-drawn X+O app icons as PNGs.
 * Pure Node (no canvas lib): rasterize into an RGBA buffer with soft-edged
 * coverage, then encode a valid PNG via zlib. Run: node tools/generate-icons.js
 * Writes icons/icon-<size>.png for 180, 192, 512.
 */
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

/* ---- tiny PNG encoder (8-bit RGBA) ---- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // bit depth 8, color type 6 (RGBA)
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/* ---- drawing ---- */
const PAPER = [243, 236, 221];
const RULE = [ // paper blended with rgba(46,95,163,0.17)
  Math.round(243 * 0.83 + 46 * 0.17),
  Math.round(236 * 0.83 + 95 * 0.17),
  Math.round(221 * 0.83 + 163 * 0.17),
];
const BLUE = [46, 95, 163];
const RED = [192, 57, 43];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp01(t);
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function drawIcon(s) {
  const rgba = Buffer.alloc(s * s * 4);
  const edge = Math.max(1, s * 0.004); // AA softness
  // O (blue ring), upper-left
  const oc = { x: s * 0.40, y: s * 0.42, r: s * 0.185, t: s * 0.085 };
  // X (red), lower-right
  const xc = { x: s * 0.60, y: s * 0.60, r: s * 0.175, w: s * 0.09 };

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let col = PAPER;
      // faint ruled lines every ~0.20s
      const yy = y + 0.5;
      const period = s * 0.20;
      const distLine = Math.abs(((yy % period) - period * 0.72));
      if (distLine < Math.max(0.6, s * 0.004)) col = RULE;

      let r = col[0], g = col[1], b = col[2];
      const px = x + 0.5, py = y + 0.5;

      // O ring coverage
      const dRing = Math.abs(Math.hypot(px - oc.x, py - oc.y) - oc.r);
      const aO = clamp01((oc.t / 2 - dRing) / edge + 0.5);
      if (aO > 0) { r = r * (1 - aO) + BLUE[0] * aO; g = g * (1 - aO) + BLUE[1] * aO; b = b * (1 - aO) + BLUE[2] * aO; }

      // X coverage (two strokes)
      const d1 = distToSeg(px, py, xc.x - xc.r, xc.y - xc.r, xc.x + xc.r, xc.y + xc.r);
      const d2 = distToSeg(px, py, xc.x + xc.r, xc.y - xc.r, xc.x - xc.r, xc.y + xc.r);
      const dX = Math.min(d1, d2);
      const aX = clamp01((xc.w / 2 - dX) / edge + 0.5);
      if (aX > 0) { r = r * (1 - aX) + RED[0] * aX; g = g * (1 - aX) + RED[1] * aX; b = b * (1 - aX) + RED[2] * aX; }

      const i = (y * s + x) * 4;
      rgba[i] = Math.round(r); rgba[i + 1] = Math.round(g); rgba[i + 2] = Math.round(b); rgba[i + 3] = 255;
    }
  }
  return encodePNG(s, s, rgba);
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
[180, 192, 512].forEach((s) => {
  const png = drawIcon(s);
  fs.writeFileSync(path.join(outDir, "icon-" + s + ".png"), png);
  console.log("wrote icons/icon-" + s + ".png (" + png.length + " bytes)");
});
