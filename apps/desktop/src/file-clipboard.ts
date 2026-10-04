import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

/* What the clipboard holds for files a person copied: the paths as text, and per raw format of the platform its bytes as text. */
export interface FileClipboard {
    text: string;
    formats: Record<string, string>;
}

/* How Electron's `clipboard.write` names a format of the platform's own rather than a MIME type. */
export function osClipboardFormat(format: string): string {
    return `electron application/osclipboard;format="${format}"`;
}

/* The paths a page asked to copy, or null when it sent anything but a list of absolute paths. */
export function copyablePaths(paths: unknown): string[] | null {
    if (!Array.isArray(paths) || paths.length === 0) {
        return null;
    }
    return paths.every((path) => typeof path === 'string' && isAbsolute(path)) ? (paths as string[]) : null;
}

function escapeXml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/*
 * The files as the platform's file manager pastes them, or null on a platform this has no format for.
 * macOS bridges `NSFilenamesPboardType` into one file URL per item, which is what Finder reads; the
 * GNOME file manager reads its own list and the others the URI list of RFC 2483.
 */
export function fileClipboard(platform: NodeJS.Platform, paths: readonly string[]): FileClipboard | null {
    const text = paths.join('\n');
    if (platform === 'darwin') {
        const strings = paths.map((path) => `<string>${escapeXml(path)}</string>`).join('');
        const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><array>${strings}</array></plist>\n`;
        return { text, formats: { NSFilenamesPboardType: plist } };
    }
    if (platform === 'linux') {
        const uris = paths.map((path) => pathToFileURL(path).href);
        return {
            text,
            formats: {
                'text/uri-list': `${uris.join('\r\n')}\r\n`,
                'x-special/gnome-copied-files': ['copy', ...uris].join('\n')
            }
        };
    }
    return null;
}
