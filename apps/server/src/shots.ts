import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/* A shot is read once, by the agent that asked for it; a day later it is only a file nobody opens. */
const SHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/* An id comes from the project file, so it never becomes a path of its own. */
const fileSafe = (id: string): string => id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'shot';

/* Yesterday's shots, taken away as a new one is written, so nothing here grows without end. */
const sweep = async (folder: string, now: number): Promise<void> => {
    const oldest = now - SHOT_MAX_AGE_MS;
    const names = await readdir(folder).catch(() => []);
    for (const name of names) {
        const taken = Number(/-(\d+)\.png$/.exec(name)?.[1]);
        if (Number.isFinite(taken) && taken < oldest) {
            await rm(join(folder, name)).catch(() => undefined);
        }
    }
};

/* Writes a png an agent asked for under the machine's own folder, outside any project, and answers its path. */
export const writeShot = async (home: string, id: string, image: Uint8Array): Promise<string> => {
    const folder = join(home, 'screenshots');
    await mkdir(folder, { recursive: true });
    const now = Date.now();
    await sweep(folder, now);
    const path = join(folder, `${fileSafe(id)}-${now}.png`);
    await writeFile(path, image);
    return path;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/* The size a png says it has in its header chunk, which comes first by the format's rule; null for anything else. */
export const pngSize = (image: Uint8Array): { width: number; height: number } | null => {
    if (image.byteLength < 24 || PNG_SIGNATURE.some((byte, index) => image[index] !== byte)) {
        return null;
    }
    const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
    if (String.fromCharCode(...image.subarray(12, 16)) !== 'IHDR') {
        return null;
    }
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width > 0 && height > 0 ? { width, height } : null;
};
