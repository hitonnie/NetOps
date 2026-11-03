// Renders the NetOps logo — a 16×16 pixel-art computer — to every icon the game uses:
//   public/favicon.svg — browser tab icon + start-screen logo
//   build/icon.ico     — Windows exe + installer icon (16–256 px, PNG-compressed)
//   electron/icon.png  — desktop window / taskbar icon
// Pure Node, no image libraries; larger sizes are exact nearest-neighbour scales of the art.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const ART = [
  '................',
  '.KKKKKKKKKKKKKK.',
  '.KFFFFFFFFFFFFK.',
  '.KFKKKKKKKKKKFK.',
  '.KFKSWWSSSSSKFK.',
  '.KFKSYSSSSSSKFK.',
  '.KFKSSYSSSSSKFK.',
  '.KFKSYSSYYYSKFK.',
  '.KFKSSSSSSSSKFK.',
  '.KFKKKKKKKKKKFK.',
  '.KFFFFFFFFFFGFK.',
  '.KHHHHHHHHHHHHK.',
  '.KKKKKKKKKKKKKK.',
  '......KHHK......',
  '..KFFFFFFFFFFK..',
  '..KKKKKKKKKKKK..',
];
const PALETTE = {
  K: '#0b0b0e', // outline
  F: '#e8e2cf', // beige case
  H: '#b3a98f', // case shadow
  S: '#2b6cc4', // screen
  W: '#9fd0ff', // glare
  Y: '#f5b70a', // ">_" prompt
  G: '#3ecf6e', // power LED
};
const N = ART.length;
for (const row of ART) if (row.length !== N) throw new Error(`art row is ${row.length} wide, expected ${N}: ${row}`);

const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function render(size) {
  const k = size / N;
  if (!Number.isInteger(k)) throw new Error(`size ${size} is not a multiple of ${N}`);
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = ART[Math.floor(y / k)][Math.floor(x / k)];
      if (c === '.') continue;
      const [r, g, b] = rgb(PALETTE[c]);
      const o = (y * size + x) * 4;
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = 255;
    }
  }
  return png(size, px);
}

function svg() {
  // one rect per horizontal run of the same colour
  const rects = [];
  ART.forEach((row, y) => {
    let x = 0;
    while (x < N) {
      const c = row[x];
      let w = 1;
      while (x + w < N && row[x + w] === c) w++;
      if (c !== '.') rects.push(`<rect x="${x}" y="${y}" width="${w}" height="1" fill="${PALETTE[c]}"/>`);
      x += w;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges">${rects.join('')}</svg>\n`;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, data }, n) => {
    const e = 6 + n * 16;
    head[e] = size >= 256 ? 0 : size;
    head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4); // planes
    head.writeUInt16LE(32, e + 6); // bpp
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map((im) => im.data)]);
}

mkdirSync('build', { recursive: true });
mkdirSync('public', { recursive: true });
writeFileSync('public/favicon.svg', svg());
writeFileSync('build/icon.ico', ico([16, 32, 48, 64, 128, 256].map((size) => ({ size, data: render(size) }))));
writeFileSync('electron/icon.png', render(256));
console.log('wrote public/favicon.svg, build/icon.ico and electron/icon.png');
