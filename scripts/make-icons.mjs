// Dependency-free PNG icon generator: green rounded square + white "G".
// Run: node scripts/make-icons.mjs  (writes apps/web/public/icons/*)
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

function crc(table, buf) {
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(TABLE, body));
  return Buffer.concat([len, body, sum]);
}

// Minimal 5x7 bitmap font for "G"
const FONT = {
  G: ["01110", "10000", "10110", "10010", "01110"],
};

function drawLetter(px, x0, y0, scale, color, glyph) {
  for (let r = 0; r < glyph.length; r++) {
    for (let c = 0; c < glyph[r].length; c++) {
      if (glyph[r][c] !== "1") continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const x = x0 + c * scale + dx;
          const y = y0 + r * scale + dy;
          const i = (y * px.w + x) * 4;
          px.buf[i] = color[0];
          px.buf[i + 1] = color[1];
          px.buf[i + 2] = color[2];
          px.buf[i + 3] = 255;
        }
      }
    }
  }
}

function makePng(size) {
  const px = { w: size, h: size, buf: Buffer.alloc(size * size * 4) };
  const R = Math.floor(size * 0.22);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.min(Math.max(x, R), size - 1 - R);
      const cy = Math.min(Math.max(y, R), size - 1 - R);
      const dx = x - cx;
      const dy = y - cy;
      const inside = dx * dx + dy * dy <= R * R;
      const i = (y * size + x) * 4;
      if (inside) {
        px.buf[i] = 22;
        px.buf[i + 1] = 163;
        px.buf[i + 2] = 74;
        px.buf[i + 3] = 255;
      } else {
        px.buf[i + 3] = 0;
      }
    }
  }
  const scale = Math.floor(size / 14);
  const gw = 5 * scale;
  const gh = 5 * scale;
  drawLetter(px, Math.floor((size - gw) / 2), Math.floor((size - gh) / 2), scale, [255, 255, 255], FONT.G);

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.buf.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("apps/web/public/icons", { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(`apps/web/public/icons/icon-${size}.png`, makePng(size));
  console.log(`wrote icon-${size}.png`);
}
