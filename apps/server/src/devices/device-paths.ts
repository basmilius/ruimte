import { extname } from 'node:path';
import type { DeviceAction } from '@ruimte/contracts';
import { DeviceError } from './device-error.ts';

/* What the photos app of either platform imports. */
const MEDIA_IMAGES: readonly string[] = ['.png', '.jpg', '.jpeg', '.heic', '.gif'];
const MEDIA_VIDEOS: readonly string[] = ['.mp4', '.mov'];

/* The paths on the machine a device action reads, which the daemon checks before any backend sees them. */
export function actionPaths(action: DeviceAction): string[] {
    switch (action.action) {
        case 'installApp':
            return [action.path];
        case 'addMedia':
            return [...action.paths];
        case 'setCamera':
            return action.path === undefined ? [] : [action.path];
        default:
            return [];
    }
}

/* Refuses a path whose extension is not one of `allowed`, naming what this device takes instead. */
export function requireExtension(path: string, allowed: readonly string[], takes: string): void {
    const extension = extname(path.replace(/\/+$/, '')).toLowerCase();
    if (!allowed.includes(extension)) {
        throw new DeviceError('device-path-refused', `${path} is not something this device takes: it takes ${takes}`);
    }
}

export function requireMedia(paths: readonly string[]): void {
    for (const path of paths) {
        requireExtension(path, [...MEDIA_IMAGES, ...MEDIA_VIDEOS], 'png, jpg, jpeg, heic, gif, mp4 or mov');
    }
}

export function isVideo(path: string): boolean {
    return MEDIA_VIDEOS.includes(extname(path).toLowerCase());
}
