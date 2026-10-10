import { expect, test } from 'bun:test';
import { sniffImageMime } from './chat-image.ts';

function padded(prefix: readonly number[] | string, at = 0, size = 40): Uint8Array {
    const bytes = new Uint8Array(size);
    bytes.set(typeof prefix === 'string' ? [...prefix].map((character) => character.charCodeAt(0)) : prefix, at);
    return bytes;
}

test('sniffs the four attachment image types from their leading bytes', () => {
    expect(sniffImageMime(padded([137, 80, 78, 71, 13, 10, 26, 10]))).toBe('image/png');
    expect(sniffImageMime(padded([255, 216, 255, 224]))).toBe('image/jpeg');
    expect(sniffImageMime(padded('GIF89a'))).toBe('image/gif');
    const webp = padded('RIFF');
    webp.set(padded('WEBP', 0, 4), 8);
    expect(sniffImageMime(webp)).toBe('image/webp');
});

test('reads anything else, or a header cut short, as no image', () => {
    expect(sniffImageMime(padded('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffImageMime(padded('GIF89a', 0, 8))).toBeNull();
    expect(sniffImageMime(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))).toBeNull();
});
