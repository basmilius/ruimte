// Live appends allow 500 tokens. A UTF-8 byte bound stays below it without a tokenizer.
export const MAX_APPEND_BYTES = 480;

/* Cut on character boundaries, so a chunk never splits a character between two appends. */
export function contextChunks(text: string): string[] {
    const encoder = new TextEncoder();
    const chunks: string[] = [];
    let chunk = '';
    let bytes = 0;
    for (const character of text) {
        const size = encoder.encode(character).length;
        if (bytes + size > MAX_APPEND_BYTES) {
            chunks.push(chunk);
            chunk = '';
            bytes = 0;
        }
        chunk += character;
        bytes += size;
    }
    if (chunk) {
        chunks.push(chunk);
    }
    return chunks;
}
