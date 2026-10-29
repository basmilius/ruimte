const HEADER = 'diff --git ';

/* Git's normalized patch stream, capped per file and in total without retaining an oversized line. */
export async function collectTreePatches(
    stream: ReadableStream<Uint8Array>,
    count: number,
    fileLimit: number,
    totalLimit: number
): Promise<Array<string | null>> {
    const patches: Array<string | null> = Array.from({ length: count }, () => null);
    const decoder = new TextDecoder();
    let index = -1;
    let body: string | null = null;
    let budget = totalLimit;
    let prefix = '';
    let probing = true;

    const finish = (): void => {
        if (index >= 0 && index < count && body !== null) {
            patches[index] = body;
            budget -= body.length;
        }
    };

    const append = (piece: string): void => {
        if (index < 0 || index >= count || body === null) {
            return;
        }

        body = body.length + piece.length > Math.min(fileLimit, budget) ? null : body + piece;
    };

    const consume = (text: string): void => {
        let offset = 0;

        while (offset < text.length) {
            const newline = text.indexOf('\n', offset);
            const lineEnd = newline < 0 ? text.length : newline + 1;

            if (probing) {
                const end = Math.min(lineEnd, offset + HEADER.length - prefix.length);
                prefix += text.slice(offset, end);
                offset = end;

                if (prefix === HEADER) {
                    finish();
                    index += 1;
                    body = '';
                    append(prefix);
                    prefix = '';
                    probing = false;
                } else if (prefix.endsWith('\n')) {
                    append(prefix);
                    prefix = '';
                } else if (prefix.length === HEADER.length) {
                    append(prefix);
                    prefix = '';
                    probing = false;
                }
            } else {
                append(text.slice(offset, lineEnd));
                offset = lineEnd;
                probing = newline >= 0;
            }
        }
    };

    for await (const chunk of stream) {
        consume(decoder.decode(chunk, { stream: true }));
    }

    consume(decoder.decode());
    append(prefix);
    finish();

    // An unexpected file boundary must never attach one file's patch to another file's path.
    return index + 1 === count ? patches : Array.from({ length: count }, () => null);
}
