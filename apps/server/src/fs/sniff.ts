/*
 * What a file is, read from its first bytes. The name is what a person typed; these are what a
 * browser will act on, and the two are allowed to disagree.
 */

const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean =>
    bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

const MAGIC: readonly { mime: string; signature: readonly number[] }[] = [
    { mime: 'image/png', signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    { mime: 'image/jpeg', signature: [0xff, 0xd8, 0xff] },
    { mime: 'image/gif', signature: ascii('GIF87a') },
    { mime: 'image/gif', signature: ascii('GIF89a') },
    { mime: 'application/pdf', signature: ascii('%PDF-') }
];

// Brands an `ftyp` box can carry that hold sound and no picture; the container is the same as MP4's.
const AUDIO_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ']);

const latin1 = (bytes: Uint8Array): string => new TextDecoder('latin1').decode(bytes);

/* The mime a file's first bytes claim, or null when nothing recognizes them. */
export const sniffMime = (bytes: Uint8Array): string | null => {
    for (const { mime, signature } of MAGIC) {
        if (startsWith(bytes, signature)) {
            return mime;
        }
    }
    // WebP is a RIFF container: the form type sits four bytes past the length.
    if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes.subarray(8), ascii('WEBP'))) {
        return 'image/webp';
    }
    // An ISO base media file (MP4, M4V, MOV) names itself in an `ftyp` box four bytes in, and the
    // brand behind it says which flavor: QuickTime carries codecs no browser has to play.
    if (startsWith(bytes.subarray(4), ascii('ftyp'))) {
        const brand = latin1(bytes.subarray(8, 12));
        if (AUDIO_BRANDS.has(brand)) {
            return null;
        }
        return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
    }
    // WebM and Matroska share the EBML header; the DocType a few bytes in is what tells them apart.
    if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
        return latin1(bytes.subarray(0, 64)).includes('webm') ? 'video/webm' : 'video/x-matroska';
    }
    if (startsWith(bytes, ascii('OggS'))) {
        return 'video/ogg';
    }
    return null;
};

/*
 * SVG is text, and the viewer still wants an image. Only a file that opens as one counts: a markdown
 * page that mentions `<svg>` halfway down is prose, not a drawing.
 */
export const looksLikeSvg = (bytes: Uint8Array): boolean => {
    const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 1024)).replace(/^﻿/, '').trimStart();
    return (head.startsWith('<?xml') || head.startsWith('<!--') || head.startsWith('<svg')) && head.toLowerCase().includes('<svg');
};
