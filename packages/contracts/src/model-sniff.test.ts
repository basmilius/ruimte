import { describe, expect, test } from 'bun:test';
import { isAsciiStl, isBinaryGltf, isBinaryStl, isUsdz, sniffModelMime } from './model-sniff.ts';

const latin1 = (value: string): Uint8Array => Uint8Array.from(value, (character) => character.charCodeAt(0));

/* A binary STL with `triangles` zeroed triangles behind an 80-byte header that opens with `header`. */
function binaryStl(triangles: number, header = ''): Uint8Array {
    const bytes = new Uint8Array(84 + 50 * triangles);
    bytes.set(latin1(header));
    new DataView(bytes.buffer).setUint32(80, triangles, true);
    return bytes;
}

/* The header of a binary glTF: the magic, a container version and the total length. */
function glb(version: number): Uint8Array {
    const header = new Uint8Array(12);
    header.set(latin1('glTF'));
    new DataView(header.buffer).setUint32(4, version, true);
    new DataView(header.buffer).setUint32(8, 12, true);
    return header;
}

/* The local file header of a zip's first entry, stored, with the name the sniff reads. */
function zipEntry(name: string): Uint8Array {
    const header = new Uint8Array(30);
    header.set(latin1('PK\x03\x04'));
    header[26] = name.length;
    return Uint8Array.from([...header, ...latin1(name), ...latin1('PXR-USDC')]);
}

describe('a 3D model from its bytes', () => {
    test('a binary glTF is told by its version', () => {
        expect(isBinaryGltf(glb(2))).toBe(true);
        expect(isBinaryGltf(glb(1))).toBe(false);
        expect(sniffModelMime(glb(2))).toBe('model/gltf-binary');
    });

    test('a USDZ is a zip told by the root layer that opens it', () => {
        expect(isUsdz(zipEntry('teapot.usdc'))).toBe(true);
        expect(isUsdz(zipEntry('Scene.USDA'))).toBe(true);
        expect(isUsdz(zipEntry('scene.usd'))).toBe(true);
        expect(isUsdz(zipEntry('README.md'))).toBe(false);
        expect(isUsdz(zipEntry('teapot.usdc.png'))).toBe(false);
        expect(isUsdz(zipEntry('teapot.usdc').subarray(0, 36))).toBe(false);
        expect(sniffModelMime(zipEntry('teapot.usdc'))).toBe('model/vnd.usdz+zip');
    });

    test('a binary STL is told by its size and an ASCII STL by its opening words', () => {
        const ascii = 'solid bracket\n  facet normal 0 0 1\n    outer loop\n      vertex 0 0 0\n    endloop\n  endfacet\nendsolid bracket\n';
        expect(isBinaryStl(binaryStl(2))).toBe(true);
        expect(isAsciiStl(latin1(ascii))).toBe(true);
        expect(isAsciiStl(latin1('\n\t SOLID part\nFacet  Normal 0 0 1\n'))).toBe(true);
        expect(isAsciiStl(latin1('solid empty\nendsolid empty\n'))).toBe(true);
        // Many exporters write their name into the binary header, `solid` included.
        expect(sniffModelMime(binaryStl(3, 'solid exported by a CAD tool'))).toBe('model/stl');
        // Only the head was read: the size of the whole file is what has to match.
        expect(sniffModelMime(binaryStl(3).subarray(0, 100), 84 + 50 * 3)).toBe('model/stl');
    });

    test('takes nothing for an STL that only looks like one', () => {
        expect(sniffModelMime(latin1('solid ground is what this note is about.\n'))).toBeNull();
        expect(sniffModelMime(latin1('solidarity\nendsolid\n'))).toBeNull();
        const stl = binaryStl(2);
        expect(sniffModelMime(stl.subarray(0, stl.length - 1))).toBeNull();
        expect(sniffModelMime(stl, stl.length + 50)).toBeNull();
        expect(sniffModelMime(binaryStl(0))).toBeNull();
    });
});
