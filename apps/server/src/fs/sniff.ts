/*
 * What a file is, read from its first bytes. The name is what a person typed; these are what a
 * browser will act on, and the two are allowed to disagree.
 */

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
    return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

function ascii(text: string): number[] {
    return [...text].map((char) => char.charCodeAt(0));
}

const MAGIC: readonly { mime: string; signature: readonly number[] }[] = [
    { mime: 'image/png', signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    { mime: 'image/jpeg', signature: [0xff, 0xd8, 0xff] },
    { mime: 'image/gif', signature: ascii('GIF87a') },
    { mime: 'image/gif', signature: ascii('GIF89a') },
    { mime: 'image/tiff', signature: [0x49, 0x49, 0x2a, 0x00] },
    { mime: 'image/tiff', signature: [0x4d, 0x4d, 0x00, 0x2a] },
    { mime: 'application/pdf', signature: ascii('%PDF-') }
];

// Brands an `ftyp` box can carry that hold sound and no picture; the container is the same as MP4's.
const AUDIO_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ']);

// AVIF and HEIF pictures borrow the same container; `mif1` and `msf1` only say HEIF in general.
const IMAGE_BRANDS: ReadonlyMap<string, string> = new Map([
    ['avif', 'image/avif'],
    ['avis', 'image/avif'],
    ['heic', 'image/heic'],
    ['heix', 'image/heic'],
    ['heim', 'image/heic'],
    ['heis', 'image/heic'],
    ['hevc', 'image/heic'],
    ['hevx', 'image/heic']
]);
const HEIF_BRANDS = new Set(['mif1', 'msf1']);

// The sizes of the DIB headers a BMP can carry, from the OS/2 one to BITMAPV5HEADER.
const BMP_HEADER_SIZES = new Set([12, 40, 52, 56, 64, 108, 124]);

function latin1(bytes: Uint8Array): string {
    return new TextDecoder('latin1').decode(bytes);
}

function uint32(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
    return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, littleEndian);
}

/*
 * The picture an `ftyp` box names, if any. A picture often names the generic HEIF brand first and
 * the brand of its codec further on, so the compatible brands count as much as the major one.
 */
function imageBrand(bytes: Uint8Array): string | null {
    const end = Math.min(uint32(bytes, 0, false), bytes.length);
    const brands = [latin1(bytes.subarray(8, 12))];
    for (let offset = 16; offset + 4 <= end; offset += 4) {
        brands.push(latin1(bytes.subarray(offset, offset + 4)));
    }
    const specific = brands.find((brand) => IMAGE_BRANDS.has(brand));
    if (specific) {
        return IMAGE_BRANDS.get(specific) ?? null;
    }
    return brands.some((brand) => HEIF_BRANDS.has(brand)) ? 'image/heif' : null;
}

/*
 * An ICO and a BMP open with four and two bytes that plenty of other files share, so the header
 * behind them has to hold up too: an icon names at least one image and a zero reserved byte in its
 * first entry, a bitmap has zeroed reserved bytes and a DIB header of a size that exists.
 */
function isIcon(bytes: Uint8Array): boolean {
    return (
        bytes.length >= 22 &&
        startsWith(bytes, [0x00, 0x00, 0x01, 0x00]) &&
        (bytes[4] | (bytes[5] << 8)) > 0 &&
        bytes[9] === 0 &&
        bytes[11] === 0 &&
        bytes[10] <= 1
    );
}

function isBitmap(bytes: Uint8Array): boolean {
    return bytes.length >= 18 && startsWith(bytes, ascii('BM')) && uint32(bytes, 6, true) === 0 && BMP_HEADER_SIZES.has(uint32(bytes, 14, true));
}

/*
 * Raw MPEG audio has no header, only frames: eleven set bits of sync, then a version and a layer. Layer
 * bits 00 are AAC in an ADTS frame, whose sync is twelve bits. An MP3 frame also has to name a bitrate
 * and a sample rate that exist, which keeps other binaries that happen to start with the sync out.
 */
function frameSync(bytes: Uint8Array): 'aac' | 'mpeg' | null {
    if (bytes.length < 3 || bytes[0] !== 0xff || (bytes[1] & 0xe0) !== 0xe0) {
        return null;
    }
    if ((bytes[1] & 0x06) === 0) {
        return (bytes[1] & 0x10) !== 0 ? 'aac' : null;
    }
    const known = (bytes[1] & 0x18) !== 0x08 && (bytes[2] & 0xf0) !== 0xf0 && (bytes[2] & 0x0c) !== 0x0c;
    return known ? 'mpeg' : null;
}

/* The mime a file's first bytes claim, or null when nothing recognizes them. */
export function sniffMime(bytes: Uint8Array): string | null {
    for (const { mime, signature } of MAGIC) {
        if (startsWith(bytes, signature)) {
            return mime;
        }
    }
    if (isIcon(bytes)) {
        return 'image/x-icon';
    }
    if (isBitmap(bytes)) {
        return 'image/bmp';
    }
    // WebP and WAV are RIFF containers: the form type sits four bytes past the length.
    if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes.subarray(8), ascii('WEBP'))) {
        return 'image/webp';
    }
    if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes.subarray(8), ascii('WAVE'))) {
        return 'audio/wav';
    }
    if (startsWith(bytes, ascii('fLaC'))) {
        return 'audio/flac';
    }
    // An ID3 tag sits in front of MP3 frames.
    if (startsWith(bytes, ascii('ID3'))) {
        return 'audio/mpeg';
    }
    // An ISO base media file (MP4, M4V, MOV, AVIF, HEIC) names itself in an `ftyp` box four bytes in,
    // and the brands in it say which flavor: QuickTime carries codecs no browser has to play.
    if (startsWith(bytes.subarray(4), ascii('ftyp'))) {
        const image = imageBrand(bytes);
        if (image) {
            return image;
        }
        const brand = latin1(bytes.subarray(8, 12));
        if (AUDIO_BRANDS.has(brand)) {
            return 'audio/mp4';
        }
        return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
    }
    // WebM and Matroska share the EBML header; the DocType a few bytes in is what tells them apart.
    if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
        return latin1(bytes.subarray(0, 64)).includes('webm') ? 'video/webm' : 'video/x-matroska';
    }
    // The first page of an Ogg stream holds the header of its first codec; only Theora is a picture.
    if (startsWith(bytes, ascii('OggS'))) {
        return latin1(bytes.subarray(0, 64)).includes('theora') ? 'video/ogg' : 'audio/ogg';
    }
    const frame = frameSync(bytes);
    if (frame !== null) {
        return frame === 'aac' ? 'audio/aac' : 'audio/mpeg';
    }
    return null;
}

/*
 * SVG is text, and the viewer still wants an image. Only a file that opens as one counts: a markdown
 * page that mentions `<svg>` halfway down is prose, not a drawing.
 */
export function looksLikeSvg(bytes: Uint8Array): boolean {
    const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 1024)).replace(/^﻿/, '').trimStart();
    return (head.startsWith('<?xml') || head.startsWith('<!--') || head.startsWith('<svg')) && head.toLowerCase().includes('<svg');
}
