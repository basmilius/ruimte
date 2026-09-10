import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ProjectDocumentSchema, type ProjectContent, type ProjectDocument } from '@ruimte/contracts';
import { isNotFound, writeAtomic } from '../fs.ts';

export const PROJECT_DIR = '.ruimte';
export const PROJECT_FILE = 'project.json';

type ReadOutcome = { kind: 'ok'; document: ProjectDocument; text: string } | { kind: 'missing' } | { kind: 'corrupt'; setAside: string };

/*
 * Reads a canvas file. A file that is not a valid document is moved next to itself with a
 * timestamp, so a bad merge or a crash never costs the person their canvas and never gets
 * written over by a fresh one.
 */
export const readDocument = async (path: string): Promise<ReadOutcome> => {
    let text: string;
    try {
        text = await readFile(path, 'utf8');
    } catch (e) {
        if (isNotFound(e)) {
            return { kind: 'missing' };
        }
        throw e;
    }
    const parsed = parseDocument(text);
    if (parsed) {
        return { kind: 'ok', document: parsed, text };
    }
    const setAside = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await rename(path, setAside);
    return { kind: 'corrupt', setAside };
};

export const parseDocument = (text: string): ProjectDocument | null => {
    try {
        const result = ProjectDocumentSchema.safeParse(JSON.parse(text));
        return result.success ? result.data : null;
    } catch {
        return null;
    }
};

/* Pretty-printed with a trailing newline, so a diff of the file in git reads like one. */
export const serializeDocument = (document: ProjectDocument): string => `${JSON.stringify(document, null, 2)}\n`;

export const writeDocument = async (path: string, document: ProjectDocument): Promise<string> => {
    await mkdir(dirname(path), { recursive: true });
    const text = serializeDocument(document);
    await writeAtomic(path, text, 0o644);
    return text;
};

const toPosix = (path: string): string => path.split(sep).join('/');

/*
 * Paths inside the project folder are stored relative to it, so a clone on another machine
 * resolves them against its own checkout. Anything outside the folder stays absolute.
 */
export const toPortable = (content: ProjectContent, folder: string | null): ProjectContent => {
    if (!folder) {
        return content;
    }
    return {
        ...content,
        nodes: content.nodes.map((node) => {
            if (!node.cwd || !isAbsolute(node.cwd)) {
                return node;
            }
            const rel = relative(folder, node.cwd);
            if (rel === '') {
                return { ...node, cwd: '.' };
            }
            if (rel.startsWith('..') || isAbsolute(rel)) {
                return node;
            }
            return { ...node, cwd: `./${toPosix(rel)}` };
        })
    };
};

export const fromPortable = <T extends ProjectContent>(content: T, folder: string | null): T => {
    if (!folder) {
        return content;
    }
    return {
        ...content,
        nodes: content.nodes.map((node) => (node.cwd && !isAbsolute(node.cwd) ? { ...node, cwd: resolve(folder, node.cwd) } : node))
    };
};

export const documentPathInFolder = (folder: string): string => join(folder, PROJECT_DIR, PROJECT_FILE);

// What an uploaded icon may be, and what it is called on disk. An `.ico` is a favicon, not
// something a person picks in a file dialog, so it is read but never written.
export const ICON_EXTENSION_BY_MIME: Record<string, string> = {
    'image/svg+xml': 'svg',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp'
};

const ICON_EXTENSIONS = Object.values(ICON_EXTENSION_BY_MIME).concat('jpeg');

export const iconPathInFolder = (folder: string, extension: string): string => join(folder, PROJECT_DIR, `icon.${extension}`);

/* Only one `.ruimte/icon.*` may exist, or the derivation order would decide which one wins. */
export const removeIconFiles = async (folder: string): Promise<void> => {
    for (const extension of ICON_EXTENSIONS) {
        await rm(iconPathInFolder(folder, extension), { force: true });
    }
};

export const writeIconFile = async (folder: string, extension: string, bytes: Uint8Array): Promise<string> => {
    const path = iconPathInFolder(folder, extension);
    await mkdir(dirname(path), { recursive: true });
    await removeIconFiles(folder);
    await writeAtomic(path, bytes, 0o644);
    return path;
};
