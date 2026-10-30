import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/*
 * Packs the white app icon into the .ico of the Windows app and its daemon. Windows picks a size per place,
 * from the taskbar's 16 px to Explorer's 256 px, so a small size is its own scaled image rather than a shrunk 256.
 *
 *   bun scripts/windows-icon.ts
 */
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const ENTRY_BYTES = 16;
const HEADER_BYTES = 6;

const root = join(import.meta.dirname, '..');
const source = join(root, '..', '..', 'assets', 'AppIcon.export', 'AppIcon Exports', 'AppIcon-iOS-Default-1024@1x.png');
const folder = mkdtempSync(join(tmpdir(), 'ruimte-icon-'));

const images = SIZES.map((size) => {
    const file = join(folder, `${size}.png`);
    const scaled = spawnSync('sips', ['-z', String(size), String(size), source, '--out', file], { stdio: 'ignore' });
    if (scaled.status !== 0) {
        console.error(`sips could not scale ${source} to ${size} px`);
        process.exit(scaled.status ?? 1);
    }
    return { size, bytes: readFileSync(file) };
});
rmSync(folder, { recursive: true, force: true });

const header = Buffer.alloc(HEADER_BYTES + ENTRY_BYTES * images.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach(({ size, bytes }, index) => {
    const at = HEADER_BYTES + ENTRY_BYTES * index;
    // A byte holds the size, so 256 is written as 0.
    header.writeUInt8(size % 256, at);
    header.writeUInt8(size % 256, at + 1);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(bytes.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += bytes.length;
});

const out = join(root, 'build', 'icon', 'AppIcon.ico');
writeFileSync(out, Buffer.concat([header, ...images.map(({ bytes }) => bytes)]));
console.log(`Wrote ${out}`);
