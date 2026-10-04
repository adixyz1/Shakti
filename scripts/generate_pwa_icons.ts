import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// Minimal dependency-free PNG generator for solid/shield icons (192x192 and 512x512)
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Buffer): Buffer {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function createShieldPng(size: number): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawRows = Buffer.alloc(size * (size * 4 + 1));
  const cx = size / 2;
  const cy = size / 2;
  const dotRadius = size * 0.11;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    rawRows[rowStart] = 0; // filter type 0
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= dotRadius) {
        // Inner white circle (#F8FAFC)
        rawRows[px] = 248;
        rawRows[px + 1] = 250;
        rawRows[px + 2] = 252;
        rawRows[px + 3] = 255;
      } else {
        // Deep teal background (#0F766E)
        rawRows[px] = 15;
        rawRows[px + 1] = 118;
        rawRows[px + 2] = 110;
        rawRows[px + 3] = 255;
      }
    }
  }

  const compressed = zlib.deflateSync(rawRows);
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

const iconsDir = path.join(process.cwd(), 'public', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });
fs.writeFileSync(path.join(iconsDir, 'icon-192x192.png'), createShieldPng(192));
fs.writeFileSync(path.join(iconsDir, 'icon-512x512.png'), createShieldPng(512));
console.log('Generated public/icons/icon-192x192.png and icon-512x512.png');
