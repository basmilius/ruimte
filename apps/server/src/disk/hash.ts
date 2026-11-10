export interface FileDigest {
    size: number;
    sha256: string;
}

export function sha256(data: string | Uint8Array): string {
    return new Bun.CryptoHasher('sha256').update(data).digest('hex');
}

export async function sha256Of(path: string): Promise<string> {
    return (await digestStream(Bun.file(path).stream())).sha256;
}

export async function digestStream(stream: AsyncIterable<Uint8Array>, write?: (chunk: Uint8Array) => Promise<void>): Promise<FileDigest> {
    const hasher = new Bun.CryptoHasher('sha256');
    let size = 0;
    for await (const chunk of stream) {
        hasher.update(chunk);
        size += chunk.byteLength;
        await write?.(chunk);
    }
    return { size, sha256: hasher.digest('hex') };
}
