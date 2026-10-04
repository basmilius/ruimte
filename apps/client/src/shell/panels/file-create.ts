import { absoluteOf, ancestorDirsOf, isDirectoryPath } from '@/shell/panels/files-tree';
import type { FsEntry } from '@ruimte/contracts';

export type NewEntryKind = 'file' | 'directory';

/* The name of the row the tree holds open while a name is typed; `FILES_TREE_CSS` hides it, since the typed row is drawn over it. */
export const NEW_ENTRY_NAME = '.ruimte-new';

/* A name longer than this in bytes is one no common file system keeps. */
const MAX_SEGMENT_BYTES = 255;

const WINDOWS_CHARACTERS = new Set(['<', '>', ':', '"', '|', '?', '*']);

export type NameProblem = 'empty' | 'segment' | 'dots' | 'characters' | 'long' | 'reserved' | 'exists' | 'in-file';

export interface NameFault {
    problem: NameProblem;
    /* The segment the problem is about, for the sentence that names it. */
    name: string;
}

export interface NewEntryContext {
    /* Whether the folder the entry is made in is the project folder, the only place `.ruimte` is closed. */
    atRoot: boolean;
    windows: boolean;
    /* What a folder listing holds, or undefined for a folder that was never listed or is not there yet. */
    children(directory: string): readonly Pick<FsEntry, 'name' | 'path' | 'kind'>[] | undefined;
    /* The absolute path of the folder the entry is made in. */
    parent: string;
}

function hasForbiddenCharacter(segment: string, windows: boolean): boolean {
    for (const character of segment) {
        const code = character.codePointAt(0) ?? 0;
        if (code < 0x20 || code === 0x7f || character === '\\' || (windows && WINDOWS_CHARACTERS.has(character))) {
            return true;
        }
    }
    return false;
}

/* The segments a typed name stands for; a folder may end in the slash that says so. */
export function segmentsOf(input: string, kind: NewEntryKind): string[] {
    const typed = input.trim();
    return (kind === 'directory' ? typed.replace(/\/+$/, '') : typed).split('/');
}

/*
 * Why a typed name cannot be made, or null when it can. A name may hold slashes, which make the
 * folders above the last segment, so every segment is judged and the listing is walked as far as
 * it is known. The machine stays the authority: a clash the listing does not show comes back from it.
 */
export function validateNewEntry(input: string, kind: NewEntryKind, context: NewEntryContext): NameFault | null {
    if (input.trim() === '') {
        return { problem: 'empty', name: '' };
    }
    const segments = segmentsOf(input, kind);
    let directory: string | null = context.parent;
    for (const [index, segment] of segments.entries()) {
        if (segment === '') {
            return { problem: index === segments.length - 1 ? 'empty' : 'segment', name: segment };
        }
        if (segment === '.' || segment === '..') {
            return { problem: 'dots', name: segment };
        }
        if (hasForbiddenCharacter(segment, context.windows)) {
            return { problem: 'characters', name: segment };
        }
        if (new TextEncoder().encode(segment).length > MAX_SEGMENT_BYTES) {
            return { problem: 'long', name: segment };
        }
        if (segment === '.git' || (segment === '.ruimte' && index === 0 && context.atRoot)) {
            return { problem: 'reserved', name: segment };
        }
        const found: Pick<FsEntry, 'name' | 'path' | 'kind'> | undefined =
            directory === null ? undefined : context.children(directory)?.find((entry) => entry.name === segment);
        if (found === undefined) {
            // Under a folder that is not there yet nothing can clash.
            directory = null;
            continue;
        }
        if (index === segments.length - 1) {
            return { problem: 'exists', name: segment };
        }
        if (found.kind === 'file') {
            return { problem: 'in-file', name: segment };
        }
        directory = found.path;
    }
    return null;
}

/* The absolute path a typed name makes, which the machine takes. */
export function newEntryPathOf(parent: string, input: string, kind: NewEntryKind): string {
    return absoluteOf(parent, segmentsOf(input, kind).join('/'));
}

/* The folder an entry is made in for the row that was asked: the folder itself, the folder a file is in, or the project folder. */
export function creationParentOf(treePath: string | null): string {
    if (treePath === null) {
        return '';
    }
    return isDirectoryPath(treePath) ? treePath : (ancestorDirsOf(treePath).at(-1) ?? '');
}

/* Where the tree holds the row open, in the folder the entry is made in. */
export function placeholderPathOf(parentTreePath: string, kind: NewEntryKind): string {
    return `${parentTreePath}${NEW_ENTRY_NAME}${kind === 'directory' ? '/' : ''}`;
}

/* The CSS that hides the row the tree holds open, whatever folder it is in. */
export const PLACEHOLDER_CSS = `
    [data-item-path="${NEW_ENTRY_NAME}"], [data-item-path="${NEW_ENTRY_NAME}/"],
    [data-item-path$="/${NEW_ENTRY_NAME}"], [data-item-path$="/${NEW_ENTRY_NAME}/"] { visibility: hidden; }
`;

export interface Creation {
    kind: NewEntryKind;
    /* The folder the entry is made in, the way the tree names one: '' for the project folder. */
    parent: string;
}
