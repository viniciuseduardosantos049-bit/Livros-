/**
 * Gera os ícones do PWA em PNG, sem dependência nenhuma: desenha os pixels,
 * comprime com o zlib do Node e monta os chunks do PNG na mão.
 *
 * Uso: npm run icones
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'frontend', 'public', 'icons');

// Paleta do app: fundo quente escuro, marcador em âmbar.
const BG = [0x12, 0x10, 0x0e];
const AMBER_TOP = [0xea, 0xb0, 0x69];
const AMBER_BOTTOM = [0xc9, 0x88, 0x3e];

// ─────────────────────────── PNG ───────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** rgba: Uint8Array de size*size*4 */
function encodePng(rgba, size) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filtro "none"
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─────────────────────────── Desenho ───────────────────────────

/** Marcador de livro: retângulo com um entalhe em V na base. */
function dentroDoMarcador(x, y, size, escala) {
  const cx = size / 2;
  const largura = size * 0.30 * escala;
  const topo = size * (0.5 - 0.35 * escala);
  const base = size * (0.5 + 0.35 * escala);
  const entalhe = base - largura * 0.62;

  if (x < cx - largura / 2 || x > cx + largura / 2) return false;
  if (y < topo || y > base) return false;

  // canto superior arredondado
  const r = largura * 0.20;
  const dx = Math.abs(x - cx) - (largura / 2 - r);
  if (dx > 0 && y < topo + r) {
    const dy = topo + r - y;
    if (dx * dx + dy * dy > r * r) return false;
  }

  // entalhe em V
  if (y > entalhe) {
    const proporcao = (base - y) / (base - entalhe);
    if (Math.abs(x - cx) < (largura / 2) * proporcao) return false;
  }
  return true;
}

function dentroDoFundo(x, y, size, raioRelativo) {
  if (raioRelativo <= 0) return true;
  const r = size * raioRelativo;
  const px = Math.min(Math.max(x, r), size - r);
  const py = Math.min(Math.max(y, r), size - r);
  const dx = x - px;
  const dy = y - py;
  return dx * dx + dy * dy <= r * r;
}

const AMOSTRAS = 3; // supersampling 3x3 para suavizar as bordas

function desenhar(size, { raio, escala }) {
  const rgba = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let fundo = 0;
      let marca = 0;

      for (let sy = 0; sy < AMOSTRAS; sy += 1) {
        for (let sx = 0; sx < AMOSTRAS; sx += 1) {
          const px = x + (sx + 0.5) / AMOSTRAS;
          const py = y + (sy + 0.5) / AMOSTRAS;
          if (dentroDoFundo(px, py, size, raio)) fundo += 1;
          if (dentroDoMarcador(px, py, size, escala)) marca += 1;
        }
      }

      const total = AMOSTRAS * AMOSTRAS;
      const aFundo = fundo / total;
      const aMarca = (marca / total) * aFundo; // o marcador não escapa do fundo
      if (aFundo === 0) continue;

      // gradiente vertical do âmbar
      const t = Math.min(1, Math.max(0, (y / size - 0.2) / 0.6));
      const amber = AMBER_TOP.map((c, i) => c + (AMBER_BOTTOM[i] - c) * t);

      const i = (y * size + x) * 4;
      for (let canal = 0; canal < 3; canal += 1) {
        rgba[i + canal] = Math.round(BG[canal] * (1 - aMarca) + amber[canal] * aMarca);
      }
      rgba[i + 3] = Math.round(aFundo * 255);
    }
  }

  return encodePng(rgba, size);
}

// ─────────────────────────── Saída ───────────────────────────
const ICONES = [
  { arquivo: 'icon-192.png', size: 192, raio: 0.22, escala: 1 },
  { arquivo: 'icon-512.png', size: 512, raio: 0.22, escala: 1 },
  // maskable: fundo sangrando até a borda e conteúdo dentro da zona segura (80%)
  { arquivo: 'icon-192-maskable.png', size: 192, raio: 0, escala: 0.72 },
  { arquivo: 'icon-512-maskable.png', size: 512, raio: 0, escala: 0.72 },
  // iOS recorta sozinho: quadrado cheio
  { arquivo: 'apple-touch-icon.png', size: 180, raio: 0, escala: 0.9 },
  { arquivo: 'favicon-32.png', size: 32, raio: 0.22, escala: 1 },
];

fs.mkdirSync(outDir, { recursive: true });

for (const { arquivo, size, raio, escala } of ICONES) {
  const png = desenhar(size, { raio, escala });
  fs.writeFileSync(path.join(outDir, arquivo), png);
  console.log(`  ${arquivo.padEnd(26)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} kB`);
}

console.log(`\n✓ ${ICONES.length} ícones gerados em frontend/public/icons/`);
