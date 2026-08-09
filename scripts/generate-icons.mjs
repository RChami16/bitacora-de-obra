// Genera los íconos PNG de la PWA (192, 512, maskable) dibujando un
// pictograma simple de casco de obra sobre un fondo de color, pixel a pixel.
// No depende de librerías de imagen externas: usa zlib (nativo de Node)
// para codificar el PNG manualmente.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { crc32 } from "node:zlib";

const OUT_DIR = new URL("../public/icons/", import.meta.url);
mkdirSync(OUT_DIR, { recursive: true });

// Paleta de marca (ver README de decisiones de diseño).
const BG = [230, 126, 34]; // naranja casco de seguridad
const HELMET = [255, 255, 255]; // blanco
const HELMET_SHADOW = [214, 108, 26];
const BRIM = [45, 52, 54]; // gris concreto oscuro

function makePng(size, { maskableSafeZone = false } = {}) {
  const px = new Uint8Array(size * size * 4);
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };

  // Fondo
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) set(x, y, BG);
  }

  // Para íconos "maskable", Android recorta hasta un círculo central
  // (safe zone ~80%), así que el pictograma se dibuja más pequeño y centrado.
  const scale = maskableSafeZone ? 0.62 : 0.8;
  const cx = size / 2;
  const cy = size / 2 + size * 0.02;
  const r = (size * scale) / 2;

  // Domo del casco (semicírculo superior)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - (cy - r * 0.15);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= r * 0.78 && y <= cy) {
        set(x, y, HELMET);
      }
    }
  }

  // Ala del casco (elipse ancha debajo del domo)
  const brimW = r * 1.55;
  const brimH = r * 0.28;
  const brimY = cy;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / brimW;
      const dy = (y - brimY) / brimH;
      if (dx * dx + dy * dy <= 1 && y >= brimY - brimH * 0.3) {
        set(x, y, BRIM);
      }
    }
  }

  // Línea de sombra sutil en el domo para dar volumen
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - (cx - r * 0.25);
      const dy = y - (cy - r * 0.35);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= r * 0.12) set(x, y, HELMET_SHADOW);
    }
  }

  return encodePng(size, size, px);
}

// --- Codificador PNG mínimo (RGBA, sin interlace, filtro 0 por fila) ---
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < width * 4; x++) {
      raw[rowStart + 1 + x] = rgba[y * width * 4 + x];
    }
  }
  const idatData = deflateSync(raw);

  const chunk = (type, data) => {
    const typeBuf = Buffer.from(type, "ascii");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  };

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idatData),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const targets = [
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  { name: "maskable-192.png", size: 192, maskableSafeZone: true },
  { name: "maskable-512.png", size: 512, maskableSafeZone: true },
  { name: "apple-touch-icon.png", size: 180 },
];

for (const t of targets) {
  const buf = makePng(t.size, { maskableSafeZone: t.maskableSafeZone });
  writeFileSync(new URL(t.name, OUT_DIR), buf);
  console.log("Generado:", t.name);
}
