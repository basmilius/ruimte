import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CHAT_ATTACHMENT_MAX_BYTES } from '@ruimte/contracts';

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/* Only image bytes reach the system viewer; neither a source path nor an executable extension comes from the page. */
export async function openImageCopy(folder: string, name: string, bytes: Uint8Array, mime: string, openPath: (path: string) => Promise<string>): Promise<void> {
    if (
        !(bytes instanceof Uint8Array) ||
        bytes.length === 0 ||
        bytes.length > CHAT_ATTACHMENT_MAX_BYTES ||
        typeof name !== 'string' ||
        !Object.hasOwn(EXTENSIONS, mime)
    ) {
        throw new Error('Not a supported image');
    }
    const buffer = Buffer.from(bytes);
    const matches =
        (mime === 'image/png' && buffer.length >= 33 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
        (mime === 'image/jpeg' && buffer.length >= 4 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) ||
        (mime === 'image/gif' && buffer.length >= 13 && /^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6))) ||
        (mime === 'image/webp' && buffer.length >= 20 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP');
    if (!matches) {
        throw new Error('The image type does not match its bytes');
    }
    const stem =
        name
            .replace(/\.[^.]*$/, '')
            .replace(/[^a-zA-Z0-9_-]/g, '-')
            .slice(0, 80) || 'image';
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const path = join(folder, `${stem}-${randomUUID()}.${EXTENSIONS[mime]}`);
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    try {
        const error = await openPath(path);
        if (error !== '') {
            throw new Error(error);
        }
    } catch (error) {
        await rm(path, { force: true });
        throw error;
    }
}
