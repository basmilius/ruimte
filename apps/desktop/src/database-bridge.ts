import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { OpenPathPurpose, OpenPathRequest, SavePathRequest } from '@ruimte/desktop-bridge';

/* A key names a connection of a project on a machine; anything longer is not one the page made. */
const MAX_KEY_LENGTH = 512;
/* A password, not a file: the encrypted copy of a longer one would be a page filling the disk. */
const MAX_SECRET_LENGTH = 16 * 1024;
const MAX_NAME_LENGTH = 255;
const MAX_EXTENSIONS = 8;
const EXTENSION = /^[a-z0-9]{1,10}$/i;
const PURPOSES: readonly OpenPathPurpose[] = ['import', 'database', 'identity'];

/* The extensions a SQLite database is found under, with every file beside them for one named otherwise. */
const DATABASE_EXTENSIONS = ['sqlite', 'sqlite3', 'db', 'db3'];

export interface DialogFilter {
    name: string;
    extensions: string[];
}

export interface OpenDialogPlan {
    filters: DialogFilter[];
    defaultPath?: string;
    /* An SSH key sits in a folder macOS and Linux hide. */
    showHiddenFiles: boolean;
}

export function parseSecretKey(value: unknown): string {
    if (typeof value !== 'string' || value === '' || value.length > MAX_KEY_LENGTH) {
        throw new Error('A database secret needs a key');
    }
    return value;
}

export function parseSecret(value: unknown): string | null {
    if (value === null) {
        return null;
    }
    if (typeof value !== 'string' || value.length > MAX_SECRET_LENGTH) {
        throw new Error('A database secret is a string or null');
    }
    return value;
}

/* One file per key, named after a hash of it, so a key can never name a path of its own. */
export function databaseSecretFile(folder: string, key: string): string {
    return join(folder, `${createHash('sha256').update(key).digest('hex')}.bin`);
}

function extensionsOf(value: unknown): string[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value) || value.length > MAX_EXTENSIONS || !value.every((entry) => typeof entry === 'string' && EXTENSION.test(entry))) {
        throw new Error('An extension is a few letters or digits without a dot');
    }
    return value as string[];
}

export function parseOpenPathRequest(value: unknown): OpenPathRequest {
    const request = value as Partial<OpenPathRequest> | null;
    if (typeof request !== 'object' || request === null || !PURPOSES.includes(request.purpose as OpenPathPurpose)) {
        throw new Error('A file is picked for an import, a database or an SSH key');
    }
    return { purpose: request.purpose as OpenPathPurpose, extensions: extensionsOf(request.extensions) };
}

export function parseSavePathRequest(value: unknown): SavePathRequest {
    const request = value as Partial<SavePathRequest> | null;
    const name = request?.suggestedName;
    const extension = request?.extension;
    if (typeof name !== 'string' || name === '' || name.length > MAX_NAME_LENGTH || /[/\\]/.test(name)) {
        throw new Error('A suggested name is a file name, not a path');
    }
    if (typeof extension !== 'string' || !EXTENSION.test(extension)) {
        throw new Error('An extension is a few letters or digits without a dot');
    }
    return { suggestedName: name, extension };
}

/* What the open dialog shows for a purpose. Every filter ends with all files, since a file is often named otherwise. */
export function openDialogPlan(request: OpenPathRequest, home: string, allFiles: string): OpenDialogPlan {
    const everything: DialogFilter = { name: allFiles, extensions: ['*'] };
    switch (request.purpose) {
        case 'identity':
            return { filters: [], defaultPath: join(home, '.ssh'), showHiddenFiles: true };
        case 'database':
            return { filters: [{ name: 'SQLite', extensions: DATABASE_EXTENSIONS }, everything], showHiddenFiles: false };
        case 'import': {
            const extensions = request.extensions ?? [];
            return {
                filters: extensions.length === 0 ? [] : [{ name: extensions.map((extension) => extension.toUpperCase()).join(', '), extensions }, everything],
                showHiddenFiles: false
            };
        }
    }
}

/* The filter a native dialog lists last, in the language of the interface. */
export function allFilesLabel(language: string | undefined): string {
    return language?.startsWith('nl') === true ? 'Alle bestanden' : 'All files';
}
