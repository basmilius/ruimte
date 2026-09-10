import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
    duplicateIdIn,
    isCanvasView,
    migrateDocument,
    withoutCrossViewEdges,
    type ProjectContent,
    type ProjectDocument,
    type ProjectNode,
    type ProjectView
} from '@ruimte/contracts';
import { isNotFound, writeAtomic } from '../fs.ts';

export const PROJECT_DIR = '.ruimte';
export const PROJECT_FILE = 'project.json';

/*
 * `unreadable` is broken JSON or a shape no version of ours ever wrote; `invalid` is a file that
 * parses but breaks a rule of the project, which is worth a message rather than a fresh canvas.
 */
export type DocumentParse = { kind: 'ok'; document: ProjectDocument } | { kind: 'unreadable' } | { kind: 'invalid'; message: string };

type ReadOutcome =
    | { kind: 'ok'; document: ProjectDocument; text: string }
    | { kind: 'missing' }
    | { kind: 'corrupt'; setAside: string }
    | { kind: 'invalid'; message: string };

/*
 * Reads a canvas file, version 1 or 2. A file that is not a document at all is moved next to
 * itself with a timestamp, so a bad merge or a crash never costs the person their canvas and
 * never gets written over by a fresh one. A file that breaks an invariant stays where it is:
 * only a person can decide which of the two things sharing an id was meant.
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
    if (parsed.kind === 'ok') {
        return { kind: 'ok', document: parsed.document, text };
    }
    if (parsed.kind === 'invalid') {
        return parsed;
    }
    const setAside = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await rename(path, setAside);
    return { kind: 'corrupt', setAside };
};

export const parseDocument = (text: string): DocumentParse => {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return { kind: 'unreadable' };
    }
    const document = migrateDocument(value);
    if (!document) {
        return { kind: 'unreadable' };
    }
    const duplicate = duplicateIdIn(document.views);
    if (duplicate) {
        return { kind: 'invalid', message: `Two things in this project share the id "${duplicate}"; every view and every node needs one of its own` };
    }
    return { kind: 'ok', document: { ...document, views: withoutCrossViewEdges(document.views) } };
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

/* Maps the folder of everything that has one: every node of every canvas, every standalone view. */
const mapCwd = <T extends { cwd?: string }>(carrier: T, map: (cwd: string) => string): T => (carrier.cwd ? { ...carrier, cwd: map(carrier.cwd) } : carrier);

const mapViews = (views: ProjectView[], map: (cwd: string) => string): ProjectView[] =>
    views.map((view) => {
        if (isCanvasView(view)) {
            return { ...view, nodes: view.nodes.map((node: ProjectNode) => mapCwd(node, map)) };
        }
        // A browser has no folder and a separator has nothing at all.
        return view.kind === 'browser' || view.kind === 'separator' ? view : { ...view, node: mapCwd(view.node, map) };
    });

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
        views: mapViews(content.views, (cwd) => {
            if (!isAbsolute(cwd)) {
                return cwd;
            }
            const rel = relative(folder, cwd);
            if (rel === '') {
                return '.';
            }
            return rel.startsWith('..') || isAbsolute(rel) ? cwd : `./${toPosix(rel)}`;
        })
    };
};

export const fromPortable = <T extends ProjectContent>(content: T, folder: string | null): T => {
    if (!folder) {
        return content;
    }
    return { ...content, views: mapViews(content.views, (cwd) => (isAbsolute(cwd) ? cwd : resolve(folder, cwd))) };
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
