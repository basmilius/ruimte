import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
    diagramProblemIn,
    duplicateElementIdIn,
    duplicateIdIn,
    isCanvasView,
    migrateDiagram,
    migrateDocument,
    migrateDrawing,
    storedContentOf,
    withoutCrossViewEdges,
    type DiagramDocument,
    type DrawingDocument,
    type ProjectContent,
    type ProjectDocument,
    type ProjectNode,
    type ProjectView
} from '@ruimte/contracts';
import { isNotFound, writeAtomic } from '../fs.ts';

export const PROJECT_DIR = '.ruimte';
export const PROJECT_FILE = 'project.json';
// One file per drawing view, in a directory of their own: `.ruimte` is read by people and by git,
// and its top level stays the two files the daemon documents.
export const DRAWINGS_DIR = 'drawings';
// The same rule for diagrams, in a directory beside it, so a file name never says which kind it is.
export const DIAGRAMS_DIR = 'diagrams';

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
        return { kind: 'invalid', message: `Two views or nodes in this project share the id "${duplicate}"` };
    }
    return { kind: 'ok', document: { ...document, views: withoutCrossViewEdges(document.views) } };
};

/* Pretty-printed with a trailing newline, so a diff of the file in git reads like one. An entry of a
   kind a newer Ruimte wrote goes back in exactly as it was read. */
export const serializeDocument = (document: ProjectDocument): string => `${JSON.stringify(storedContentOf(document), null, 2)}\n`;

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
        // Only a chat and a terminal carry a node; every other view has no folder to map.
        return view.kind === 'chat' || view.kind === 'terminal' ? { ...view, node: mapCwd(view.node, map) } : view;
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

export const drawingsDirOf = (documentPath: string): string => join(dirname(documentPath), DRAWINGS_DIR);

export const diagramsDirOf = (documentPath: string): string => join(dirname(documentPath), DIAGRAMS_DIR);

/* The view id, never its name: a rename must not move a file, and two machines must agree. */
export const viewFilePathIn = (dir: string, viewId: string): string => join(dir, `${encodeURIComponent(viewId)}.json`);

/* The view a drawing or diagram file belongs to, or null for a name that is not one of ours. */
export const viewIdOfFile = (filename: string): string | null => {
    if (!filename.endsWith('.json')) {
        return null;
    }
    try {
        const id = decodeURIComponent(filename.slice(0, -'.json'.length));
        return id === '' ? null : id;
    } catch {
        return null;
    }
};

/*
 * The top level indented, every element on one line. `JSON.stringify(document, null, 2)` would put
 * every point of every stroke on a line of its own, and a git diff of that says nothing.
 */
export const serializeDrawing = (document: DrawingDocument): string => {
    const elements = document.elements.map((element) => `    ${JSON.stringify(element)}`).join(',\n');
    const list = elements === '' ? '[]' : `[\n${elements}\n  ]`;
    return `{\n  "version": ${document.version},\n  "rev": ${document.rev},\n  "elements": ${list}\n}\n`;
};

export type DrawingParse = { kind: 'ok'; document: DrawingDocument } | { kind: 'unreadable' } | { kind: 'invalid'; message: string };

export const parseDrawing = (text: string): DrawingParse => {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return { kind: 'unreadable' };
    }
    const document = migrateDrawing(value);
    if (!document) {
        // JSON that is not a drawing at all: a person's file under our name, so it stays where it is.
        return { kind: 'invalid', message: 'This file is not a drawing Ruimte can read' };
    }
    const duplicate = duplicateElementIdIn(document.elements);
    if (duplicate) {
        return { kind: 'invalid', message: `Two elements in this drawing share the id "${duplicate}"` };
    }
    return { kind: 'ok', document };
};

type DrawingReadOutcome =
    | { kind: 'ok'; document: DrawingDocument; text: string }
    | { kind: 'missing' }
    | { kind: 'corrupt'; setAside: string }
    | { kind: 'invalid'; message: string };

/*
 * Reads a drawing file. Broken JSON is moved next to itself with a timestamp, the rule the project
 * file follows, so a crash or a bad merge never costs the drawing and never gets written over.
 */
export const readDrawing = async (path: string): Promise<DrawingReadOutcome> => {
    let text: string;
    try {
        text = await readFile(path, 'utf8');
    } catch (e) {
        if (isNotFound(e)) {
            return { kind: 'missing' };
        }
        throw e;
    }
    const parsed = parseDrawing(text);
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

export const writeDrawing = async (path: string, document: DrawingDocument): Promise<string> => {
    await mkdir(dirname(path), { recursive: true });
    const text = serializeDrawing(document);
    await writeAtomic(path, text, 0o644);
    return text;
};

const oneItemPerLine = (items: readonly unknown[]): string =>
    items.length === 0 ? '[]' : `[\n${items.map((item) => `    ${JSON.stringify(item)}`).join(',\n')}\n  ]`;

/* The top level indented and every node, group and edge on one line, so a diff names what was added. */
export const serializeDiagram = (document: DiagramDocument): string =>
    [
        '{',
        `  "version": ${document.version},`,
        `  "rev": ${document.rev},`,
        `  "meta": ${JSON.stringify(document.meta)},`,
        `  "nodes": ${oneItemPerLine(document.nodes)},`,
        `  "groups": ${oneItemPerLine(document.groups)},`,
        `  "edges": ${oneItemPerLine(document.edges)}`,
        '}',
        ''
    ].join('\n');

export type DiagramParse = { kind: 'ok'; document: DiagramDocument } | { kind: 'unreadable' } | { kind: 'invalid'; message: string };

export const parseDiagram = (text: string): DiagramParse => {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return { kind: 'unreadable' };
    }
    const document = migrateDiagram(value);
    if (!document) {
        // JSON that is not a diagram at all: a person's file under our name, so it stays where it is.
        return { kind: 'invalid', message: 'This file is not a diagram Ruimte can read' };
    }
    const problem = diagramProblemIn(document);
    if (problem) {
        return { kind: 'invalid', message: problem };
    }
    return { kind: 'ok', document };
};

type DiagramReadOutcome =
    | { kind: 'ok'; document: DiagramDocument; text: string }
    | { kind: 'missing' }
    | { kind: 'corrupt'; setAside: string }
    | { kind: 'invalid'; message: string };

/* Reads a diagram file under the rule a drawing follows: broken JSON is set aside, never written over. */
export const readDiagram = async (path: string): Promise<DiagramReadOutcome> => {
    let text: string;
    try {
        text = await readFile(path, 'utf8');
    } catch (e) {
        if (isNotFound(e)) {
            return { kind: 'missing' };
        }
        throw e;
    }
    const parsed = parseDiagram(text);
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

export const writeDiagram = async (path: string, document: DiagramDocument): Promise<string> => {
    await mkdir(dirname(path), { recursive: true });
    const text = serializeDiagram(document);
    await writeAtomic(path, text, 0o644);
    return text;
};

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
