/*
 * The 3D model formats told from their first bytes. The daemon sniffs every file with them and the client
 * tells the three apart in an attachment, so both read a binary glTF, a USDZ package and an STL alike.
 */

const latin1Decoder = new TextDecoder('latin1');

function latin1(bytes: Uint8Array): string {
    return latin1Decoder.decode(bytes);
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
    return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

function uint32(bytes: Uint8Array, offset: number): number {
    return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

const GLTF_MAGIC = [0x67, 0x6c, 0x54, 0x46];
const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04];

// The extensions a USD layer can carry; the first one in a package is its root layer.
const USD_LAYER = /\.usd[ac]?$/;

// An STL has no magic: a binary one is an 80-byte header, a triangle count and 50 bytes per triangle.
const STL_HEADER_BYTES = 84;
const STL_TRIANGLE_BYTES = 50;

/* A binary glTF names its container version right after the magic; version 1 was a different format. */
export function isBinaryGltf(bytes: Uint8Array): boolean {
    return bytes.length >= 8 && startsWith(bytes, GLTF_MAGIC) && uint32(bytes, 4) === 2;
}

/*
 * A USDZ package is a plain zip, so it is told from every other zip by the name of its first entry,
 * which the format requires to be the root layer.
 */
export function isUsdz(bytes: Uint8Array): boolean {
    if (bytes.length < 30 || !startsWith(bytes, ZIP_LOCAL_HEADER)) {
        return false;
    }
    const nameLength = bytes[26] | (bytes[27] << 8);
    return nameLength > 0 && bytes.length >= 30 + nameLength && USD_LAYER.test(latin1(bytes.subarray(30, 30 + nameLength)).toLowerCase());
}

/* `size` is the whole file's, which the triangle count must add up to; it defaults to the bytes given, for a file read whole. */
export function isBinaryStl(bytes: Uint8Array, size = bytes.length): boolean {
    if (bytes.length < STL_HEADER_BYTES) {
        return false;
    }
    const triangles = uint32(bytes, 80);
    return triangles > 0 && size === STL_HEADER_BYTES + STL_TRIANGLE_BYTES * triangles;
}

/* An ASCII STL opens a solid and says `facet normal` soon after, or closes it at once when it is empty. */
export function isAsciiStl(bytes: Uint8Array): boolean {
    const head = latin1(bytes).trimStart().toLowerCase();
    return /^solid(\s|$)/.test(head) && (/\bfacet\s+normal\b/.test(head) || /\bendsolid\b/.test(head));
}

/* The model mime the bytes claim, or null for anything else. The size rule of a binary STL goes first, since its header may just as well open with `solid`. */
export function sniffModelMime(bytes: Uint8Array, size = bytes.length): 'model/gltf-binary' | 'model/vnd.usdz+zip' | 'model/stl' | null {
    if (isBinaryGltf(bytes)) {
        return 'model/gltf-binary';
    }
    if (isUsdz(bytes)) {
        return 'model/vnd.usdz+zip';
    }
    return isBinaryStl(bytes, size) || isAsciiStl(bytes) ? 'model/stl' : null;
}
