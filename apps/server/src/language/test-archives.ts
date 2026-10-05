import { createHash } from 'node:crypto';
import { deflateRawSync, gzipSync } from 'node:zlib';

export interface FixtureFile {
    path: string;
    text: string;
    mode?: number;
}

function octal(value: number, length: number): string {
    return `${value.toString(8).padStart(length - 1, '0')}\0`;
}

/* A gzipped ustar archive, which is all the extraction reads. A name past 100 bytes goes in the prefix field. */
export function tarGz(files: readonly FixtureFile[]): Uint8Array {
    const blocks: Uint8Array[] = [];
    const encoder = new TextEncoder();
    for (const file of files) {
        const data = encoder.encode(file.text);
        const header = new Uint8Array(512);
        const cut = file.path.length > 100 ? file.path.lastIndexOf('/', 100) : -1;
        const prefix = cut > 0 ? file.path.slice(0, cut) : '';
        const name = cut > 0 ? file.path.slice(cut + 1) : file.path;
        header.set(encoder.encode(name), 0);
        header.set(encoder.encode(octal(file.mode ?? 0o644, 8)), 100);
        header.set(encoder.encode(octal(data.length, 12)), 124);
        header[156] = '0'.charCodeAt(0);
        header.set(encoder.encode('ustar\0' + '00'), 257);
        header.set(encoder.encode(prefix), 345);
        blocks.push(header, data, new Uint8Array((512 - (data.length % 512)) % 512));
    }
    blocks.push(new Uint8Array(1024));
    return gzipSync(Buffer.concat(blocks));
}

/* A zip with every file deflated, and the Unix mode in the external attributes the way `zip` writes it. */
export function zip(files: readonly FixtureFile[]): Uint8Array {
    const encoder = new TextEncoder();
    const parts: Buffer[] = [];
    const directory: Buffer[] = [];
    let offset = 0;
    for (const file of files) {
        const name = Buffer.from(encoder.encode(file.path));
        const raw = Buffer.from(encoder.encode(file.text));
        const packed = deflateRawSync(raw);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(8, 8);
        local.writeUInt32LE(packed.length, 18);
        local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(name.length, 26);
        const entry = Buffer.alloc(46);
        entry.writeUInt32LE(0x02014b50, 0);
        entry.writeUInt16LE((3 << 8) | 20, 4);
        entry.writeUInt16LE(20, 6);
        entry.writeUInt16LE(8, 10);
        entry.writeUInt32LE(packed.length, 20);
        entry.writeUInt32LE(raw.length, 24);
        entry.writeUInt16LE(name.length, 28);
        entry.writeUInt32LE(((file.mode ?? 0o644) << 16) >>> 0, 38);
        entry.writeUInt32LE(offset, 42);
        parts.push(local, name, packed);
        directory.push(entry, name);
        offset += local.length + name.length + packed.length;
    }
    const central = Buffer.concat(directory);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...parts, central, end]);
}

export function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}
