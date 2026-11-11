import { isPathBelow, type FsEntry } from '@ruimte/contracts';
import { TransportError } from '@/transport-api/transport';

export type DesignRead = { kind: 'listed'; entries: FsEntry[] } | { kind: 'missing' } | { kind: 'failed'; reason: string };

/*
 * What is known of a design folder: its entries, null while the folder is not there, and the reason the
 * last read failed. A failed read leaves the entries as they were, so a refresh that failed never turns
 * the pages shown into an empty design.
 */
interface DesignListing {
    entries: FsEntry[] | null;
    problem: string | null;
}

/* The read a thrown error stands for. Only the code decides: `not-found` is a folder the chat has not made, anything else is a failure. */
export function designReadFailed(error: unknown): DesignRead {
    if (error instanceof TransportError && error.code === 'not-found') {
        return { kind: 'missing' };
    }

    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
}

export function listingAfter(before: DesignListing, read: DesignRead): DesignListing {
    switch (read.kind) {
        case 'listed':
            return { entries: read.entries, problem: null };
        case 'missing':
            return { entries: null, problem: null };
        case 'failed':
            return { entries: before.entries, problem: read.reason };
    }
}

/* A listing and the machine and folder it was read from, so the pages kept through a failed read are only ever pages of the same folder. */
export interface ScopedListing {
    scope: string;
    listing: DesignListing;
}

export function designScope(endpointId: string, folder: string): string {
    return JSON.stringify([endpointId, folder]);
}

export function listingOf(scoped: ScopedListing | null, scope: string): DesignListing | null {
    return scoped !== null && scoped.scope === scope ? scoped.listing : null;
}

/* The listing after a read of `scope`, which starts empty when the one before belongs to another folder. */
export function scopedListingAfter(before: ScopedListing | null, scope: string, read: DesignRead): ScopedListing {
    return { scope, listing: listingAfter(listingOf(before, scope) ?? { entries: null, problem: null }, read) };
}

/* The pages of a design: the HTML files right in its folder, by name, as the tabs above the stage show them. */
export function designFiles(entries: readonly FsEntry[]): string[] {
    return entries
        .filter((entry) => entry.kind === 'file' && /\.html?$/i.test(entry.name))
        .map((entry) => entry.name)
        .sort((one, other) => one.localeCompare(other, undefined, { numeric: true, sensitivity: 'base' }));
}

/* The pages of a design the most recently changed first, the order its cards stand in on a canvas; a tie keeps the order of their names. */
export function pagesByChange(entries: readonly FsEntry[]): string[] {
    const changed = new Map(entries.map((entry) => [entry.name, entry.mtime]));
    return designFiles(entries).sort((one, other) => changed.get(other)! - changed.get(one)!);
}

export function pageMtime(entries: readonly FsEntry[], file: string): number | null {
    return entries.find((entry) => entry.kind === 'file' && entry.name === file)?.mtime ?? null;
}

/*
 * Whether a change the machine reports touches a design folder. The machine names the folder of each
 * changed file, and every save of the project writes a file in a parent of a private design's folder, so
 * a parent counts only while the folder was not found yet: that is how the chat making it shows.
 */
export function changeReaches(changed: string, folder: string, found: boolean): boolean {
    return changed === folder || isPathBelow(folder, changed) || (!found && isPathBelow(changed, folder));
}

/*
 * The pages in the order their cards stand: the most recently changed first, but while one is open the
 * order it was read in holds, with a page that came since on top, so a write never moves the open card.
 */
export function arrangePages(before: readonly string[] | null, pages: readonly string[], frozen: boolean): string[] {
    if (!frozen || before === null) {
        return [...pages];
    }

    return [...pages.filter((page) => !before.includes(page)), ...before.filter((page) => pages.includes(page))];
}

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

const STROKES_MARGIN = 24;

/*
 * Where a pointer is on an element in its own layout pixels. A card on a zoomed canvas is scaled, so its
 * box on the screen is larger or smaller than the pixels its bitmap and the page lay out in.
 */
export function layoutPoint(
    client: Point,
    box: { left: number; top: number; width: number; height: number },
    layout: { width: number; height: number }
): Point {
    const scaleX = box.width > 0 ? layout.width / box.width : 1;
    const scaleY = box.height > 0 ? layout.height / box.height : 1;

    return { x: (client.x - box.left) * scaleX, y: (client.y - box.top) * scaleY };
}

export function strokesBox(strokes: readonly (readonly Point[])[], size: { width: number; height: number }): Rect | null {
    const points = strokes.flat();

    if (points.length === 0) {
        return null;
    }

    const left = Math.max(0, Math.min(...points.map((point) => point.x)) - STROKES_MARGIN);
    const top = Math.max(0, Math.min(...points.map((point) => point.y)) - STROKES_MARGIN);
    const right = Math.min(size.width, Math.max(...points.map((point) => point.x)) + STROKES_MARGIN);
    const bottom = Math.min(size.height, Math.max(...points.map((point) => point.y)) + STROKES_MARGIN);

    return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

export function pageName(file: string): string {
    return file.replace(/\.html?$/i, '');
}
