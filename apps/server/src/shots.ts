import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homeFolder } from '@ruimte/service/home';
import type { Reclaimed } from './maintenance/maintenance.ts';
import { sweepFolder } from './maintenance/sweep-folder.ts';

/* A shot is read once, by the agent that asked for it; a day later it is only a file nobody opens. */
const SHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/* A person saves a capture or a recording where they want it; the machine's copy is gone after a week. */
const CAPTURE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const PLACED_CAPTURES_FOLDER = 'placed';

/* An id comes from the project file, so it never becomes a path of its own. */
function fileSafe(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'shot';
}

/*
 * Files past their age, by the time in their name; a name without one is not ours and stays. Swept as a
 * new one is written and by the daemon's maintenance, so nothing here grows without end.
 */
function sweep(folder: string, now: number, maxAgeMs: number, signal?: AbortSignal): Promise<Reclaimed> {
    const oldest = now - maxAgeMs;

    return sweepFolder(folder, {
        expired: (name) => {
            const taken = Number(/-(\d+)\.(png|mp4)$/.exec(name)?.[1]);

            return Number.isFinite(taken) && taken < oldest;
        },
        signal
    });
}

export function sweepScreenshots(home: string, now: number, signal?: AbortSignal): Promise<Reclaimed> {
    return sweep(homeFolder(home, 'screenshots'), now, SHOT_MAX_AGE_MS, signal);
}

/* Never reaches `placed`, which is a folder below this one. */
export function sweepDeviceCaptures(home: string, now: number, signal?: AbortSignal): Promise<Reclaimed> {
    return sweep(homeFolder(home, 'deviceCaptures'), now, CAPTURE_MAX_AGE_MS, signal);
}

/* Writes a png an agent asked for under the machine's own folder, outside any project, and answers its path. */
export async function writeShot(home: string, id: string, image: Uint8Array): Promise<string> {
    const folder = homeFolder(home, 'screenshots');
    await mkdir(folder, { recursive: true });
    const now = Date.now();
    await sweep(folder, now, SHOT_MAX_AGE_MS);
    const path = join(folder, `${fileSafe(id)}-${now}.png`);
    await writeFile(path, image);
    return path;
}

/* A new file for a person's capture or recording of a device, which the client reads over `bytes.read`. */
export async function captureFile(home: string, id: string, extension: 'png' | 'mp4', now = Date.now()): Promise<string> {
    const folder = homeFolder(home, 'deviceCaptures');
    await mkdir(folder, { recursive: true });
    await sweep(folder, now, CAPTURE_MAX_AGE_MS);
    return join(folder, `${fileSafe(id)}-${now}.${extension}`);
}

export async function writeCapture(home: string, id: string, image: Uint8Array, now = Date.now()): Promise<string> {
    const path = await captureFile(home, id, 'png', now);
    await writeFile(path, image);
    return path;
}

/* A capture a person placed on a canvas, which a file view reads for as long as it stays, so no sweep reaches it. */
export async function keepCapture(home: string, id: string, image: Uint8Array, now = Date.now()): Promise<string> {
    const folder = join(homeFolder(home, 'deviceCaptures'), PLACED_CAPTURES_FOLDER);
    await mkdir(folder, { recursive: true });
    const path = join(folder, `${fileSafe(id)}-${now}.png`);
    await writeFile(path, image);
    return path;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/* The size a png says it has in its header chunk, which comes first by the format's rule; null for anything else. */
export function pngSize(image: Uint8Array): { width: number; height: number } | null {
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
}
