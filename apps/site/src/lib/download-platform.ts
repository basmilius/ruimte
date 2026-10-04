import type { Platform } from './release';

export function downloadPlatform(userAgent: string): Platform | null {
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) {
        return null;
    }
    if (/Macintosh|Mac OS X/i.test(userAgent)) {
        return 'mac';
    }
    if (/Linux/i.test(userAgent)) {
        return /aarch64|arm64/i.test(userAgent) ? 'appimage-arm64' : 'appimage-x64';
    }
    return null;
}
