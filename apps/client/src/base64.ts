/* Bytes as base64 for a JSON frame, a slice at a time so a large file does not overflow the arguments of one call. */
export function base64Of(bytes: Uint8Array): string {
    const encode = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;

    if (typeof encode === 'function') {
        return encode.call(bytes);
    }

    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}
