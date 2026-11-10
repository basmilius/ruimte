import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { settled, type DirectoryWatcher, type Settled, type WatchSeams } from '@adecore/agents';
import type { Serializer } from '@adecore/utils/async';
import { isNotFound } from '@adecore/utils/errors';
import { fileExists, writeAtomic } from '@adecore/utils/fs';
import { climbsOut } from '@adecore/utils/path';
import { isRecord } from '@adecore/utils/record';
import {
    DIAGRAMS_DIR,
    DIAGRAM_VERSION,
    DRAWINGS_DIR,
    PRIVATE_DIR,
    PROJECT_DIR,
    DRAWING_VERSION,
    PROJECT_PRIVATE_VERSION,
    PROJECT_VERSION,
    ProjectPrivateFileSchema,
    diagramProblemIn,
    duplicateElementIdIn,
    duplicateIdIn,
    isCanvasView,
    isChatHostView,
    isDesignView,
    migrateDiagram,
    migrateDrawing,
    migrateSharedFile,
    newerVersionIn,
    storedViewsOf,
    withoutCrossViewEdges,
    type DiagramDocument,
    type DrawingDocument,
    type ProjectContent,
    type ProjectPrivateFile,
    type ProjectSharedFile,
    type ProjectNode,
    type ProjectView,
    type SharedFileRead,
    mapDesignChats
} from '@ruimte/contracts';
import { retryingRename } from '../disk/busy-retry.ts';
import { errorText } from '../error-text.ts';

export const PROJECT_FILE = 'project.json';
const GITIGNORE_FILE = '.gitignore';
// Editors and git write in bursts; one event per burst is what a client wants.
export const WATCH_SETTLE_MS = 150;

/*
 * `unreadable` is broken JSON or a shape no version of ours ever wrote; `invalid` is a file that
 * parses but breaks a rule of the project, which is worth a message rather than a fresh canvas;
 * `too-new` is a file from a Ruimte that is ahead of this one, which is neither.
 */
export type JsonDocumentParse<T> =
    | { kind: 'ok'; document: T }
    | { kind: 'unreadable' }
    | { kind: 'invalid'; message: string }
    | { kind: 'too-new'; version: number };

export type JsonDocumentRead<T> =
    | { kind: 'ok'; document: T; text: string }
    | { kind: 'missing' }
    | { kind: 'corrupt'; setAside: string }
    // Only for a read that was told to leave the file where it is.
    | { kind: 'unreadable' }
    | { kind: 'invalid'; message: string }
    | { kind: 'too-new'; version: number };

export interface JsonDocumentReadOptions {
    /* False for a read that follows someone else's write: a file caught halfway is whole on the next event. */
    setAside?: boolean;
}

/*
 * How the project file, a drawing and a diagram are all read. A file that is not one of ours at all
 * is moved next to itself with a timestamp, so a fresh file never writes over the person's work. One
 * that breaks an invariant stays where it is, since only a person can decide which of two things
 * sharing an id was meant, and so does one from a newer Ruimte.
 */
export async function readJsonDocument<T>(
    path: string,
    parse: (text: string) => JsonDocumentParse<T>,
    options: JsonDocumentReadOptions = {}
): Promise<JsonDocumentRead<T>> {
    let text: string;
    try {
        text = await readFile(path, 'utf8');
    } catch (e) {
        if (isNotFound(e)) {
            return { kind: 'missing' };
        }
        throw e;
    }
    const parsed = parse(text);
    if (parsed.kind === 'ok') {
        return { kind: 'ok', document: parsed.document, text };
    }
    if (parsed.kind === 'invalid' || parsed.kind === 'too-new') {
        return parsed;
    }
    if (options.setAside === false) {
        return { kind: 'unreadable' };
    }
    const setAside = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await retryingRename(rename)(path, setAside);
    return { kind: 'corrupt', setAside };
}

/* The text that landed is the answer: a caller keeps it to tell its own write from someone else's. */
export async function writeJsonDocument<T>(path: string, document: T, serialize: (document: T) => string): Promise<string> {
    await mkdir(dirname(path), { recursive: true });
    const text = serialize(document);
    await writeAtomic(path, text, 0o644, { durable: true });
    return text;
}

export function tooNewMessage(noun: string, version: number, known: number): string {
    return `This ${noun} was written by a newer Ruimte (file version ${version}, this one reads ${known}). Update Ruimte to open it.`;
}

export function documentPathInFolder(folder: string): string {
    return join(folder, PROJECT_DIR, PROJECT_FILE);
}

export function privateDirOf(documentPath: string): string {
    return join(dirname(documentPath), PRIVATE_DIR);
}

export function privatePathOf(documentPath: string): string {
    return join(privateDirOf(documentPath), PROJECT_FILE);
}

export function gitignorePathOf(documentPath: string): string {
    return join(dirname(documentPath), GITIGNORE_FILE);
}

/*
 * Written once, when a project folder has none, so a person who edits these rules keeps their edit.
 * Besides `private/` it hides the leftovers of a crashed write and of a file set aside as corrupt.
 */
export const GITIGNORE_TEXT = [
    '# Ruimte writes this folder. Everything here is meant to be committed,',
    '# except what belongs to one person or to one machine.',
    `${PRIVATE_DIR}/`,
    '*.corrupt-*',
    '*.tmp',
    ''
].join('\n');

export async function writeGitignoreIfMissing(documentPath: string): Promise<boolean> {
    const path = gitignorePathOf(documentPath);
    if (await fileExists(path)) {
        return false;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeAtomic(path, GITIGNORE_TEXT, 0o644);
    return true;
}

/* JSON that is not from a newer version, or the parse result that says why there is none. */
export function parseVersioned(text: string, known: number): { kind: 'value'; value: unknown } | JsonDocumentParse<never> {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return { kind: 'unreadable' };
    }
    const newer = newerVersionIn(value, known);
    return newer === null ? { kind: 'value', value } : { kind: 'too-new', version: newer };
}

/* The parse of a file whose whole shape is one schema, such as `launches.json` and `routines.json`. */
export function versionedParser<T>(
    schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
    known: number
): (text: string) => JsonDocumentParse<T> {
    return (text) => {
        const versioned = parseVersioned(text, known);
        if (versioned.kind !== 'value') {
            return versioned;
        }
        const parsed = schema.safeParse(versioned.value);
        return parsed.success ? { kind: 'ok', document: parsed.data } : { kind: 'unreadable' };
    };
}

export function serializeJson(file: unknown): string {
    return `${JSON.stringify(file, null, 4)}\n`;
}

/* The keys of a file this release does not know, which a write puts back as they were. */
export function restOf(file: Record<string, unknown>, known: readonly string[]): Record<string, unknown> {
    return Object.fromEntries(Object.entries(file).filter(([key]) => !known.includes(key)));
}

/* The text a read found, empty for a missing file and null for one that did not read. */
export function readTextOf<T>(read: JsonDocumentRead<T>): string | null {
    return read.kind === 'ok' ? read.text : read.kind === 'missing' ? '' : null;
}

/* A watcher per directory that is there; a missing one has nothing to watch, and a save still works. */
export function watchDirectories(seams: WatchSeams, dirs: readonly string[], heard: (filename: string | null) => void): DirectoryWatcher[] {
    return dirs
        .map((dir) => {
            try {
                const watcher = seams.watch(dir, { recursive: false }, (_event, filename) => heard(filename));
                watcher.on('error', () => undefined);
                return watcher;
            } catch {
                return null;
            }
        })
        .filter((watcher) => watcher !== null);
}

export interface FolderChain {
    /* Starts the whole chain again when its first folder has no watcher, as one that was missing; true when it has one now. */
    retry(): boolean;
    close(): void;
}

/*
 * Watches a chain of folders, each the parent of the next. A watcher on a folder that was removed never hears
 * again, and a folder that is not there yet has none, so whenever a folder hears the name of the next one (or no
 * name), the watch starts again from that next folder down. `heard` gets the depth of the folder that heard.
 *
 * With `moved`, the nearest folder above the first one that is there is watched too: it hears the first folder go,
 * which lets go of the watcher that died with it and calls `moved(false)`, and come back, which arms the chain again
 * and calls `moved(true)`. When that folder goes itself, as a disk that is ejected, the one above it takes over.
 */
export function watchFolderChain(
    seams: WatchSeams,
    folders: readonly string[],
    heard: (depth: number, filename: string | null) => void,
    moved?: (there: boolean) => void
): FolderChain {
    const watchers: (DirectoryWatcher | null)[] = folders.map(() => null);
    const root = folders[0]!;
    let anchor: { folder: string; watcher: DirectoryWatcher } | null = null;
    let closed = false;

    const arm = (from: number): void => {
        for (let depth = from; depth < folders.length; depth++) {
            watchers[depth]?.close();
            watchers[depth] = watchOne(depth);
        }
    };

    const watchOne = (depth: number): DirectoryWatcher | null => {
        const next = folders[depth + 1];
        const [watcher] = watchDirectories(seams, [folders[depth]!], (filename) => {
            if (closed) {
                return;
            }

            if (next !== undefined && (filename === null || filename === basename(next))) {
                arm(depth + 1);
            }

            heard(depth, filename);
        });

        // An error is how a watcher whose folder went away ends, so it keeps no place a retry would take for a live one.
        watcher?.on('error', () => {
            if (watchers[depth] !== watcher) {
                return;
            }

            watchers[depth] = null;

            if (depth === 0 && !closed) {
                moved?.(false);
            }
        });

        return watcher ?? null;
    };

    // The name of the folder on the way from `folder` down to the first one, which is what `folder` hears come or go.
    const towardRoot = (folder: string): string => {
        let below = root;

        while (dirname(below) !== folder && dirname(below) !== below) {
            below = dirname(below);
        }

        return basename(below);
    };

    const anchorFrom = (start: string): void => {
        anchor?.watcher.close();
        anchor = null;

        for (let folder = start; ; folder = dirname(folder)) {
            const toward = towardRoot(folder);
            const [watcher] = watchDirectories(seams, [folder], (filename) => {
                // No name says nothing of the first folder while it is watched, and the parent of a project hears its siblings too.
                if (!closed && (filename === toward || (filename === null && watchers[0] === null))) {
                    rootMoved(folder);
                }
            });

            if (watcher !== undefined) {
                anchor = { folder, watcher };
                watcher.on('error', () => anchorGone(watcher, folder));

                return;
            }

            if (dirname(folder) === folder) {
                return;
            }
        }
    };

    const anchorAt = (): void => anchorFrom(dirname(root));

    // The folder above takes over, since a folder that went may still answer a watch for a moment; it hears the one that went come back.
    const anchorGone = (watcher: DirectoryWatcher, folder: string): void => {
        if (closed || anchor?.watcher !== watcher) {
            return;
        }

        if (dirname(folder) === folder) {
            anchor = null;
        } else {
            anchorFrom(dirname(folder));
        }

        rearm();
    };

    const rearm = (): void => {
        const had = watchers[0] !== null;

        arm(0);

        const has = watchers[0] !== null;

        if (had !== has) {
            moved?.(has);
        }
    };

    const rootMoved = (heardIn: string): void => {
        if (heardIn !== dirname(root)) {
            anchorAt();
        }

        rearm();
    };

    arm(0);

    if (moved !== undefined) {
        anchorAt();
    }

    return {
        retry: () => {
            if (closed || watchers[0] !== null) {
                return false;
            }

            if (moved !== undefined && anchor?.folder !== dirname(root)) {
                anchorAt();
            }

            arm(0);

            return watchers[0] !== null;
        },
        close: () => {
            closed = true;
            anchor?.watcher.close();
            anchor = null;

            for (const watcher of watchers) {
                watcher?.close();
            }

            watchers.fill(null);
        }
    };
}

/* A store of a shared and a private file in `.ruimte` that takes in an edit it did not write itself. */
interface OutsideEdits {
    seams: WatchSeams;
    writes: Serializer;
    folder: string;
    file: string;
    /* What the files hold, as the warning names it. */
    what: string;
    /* Whether the state the watch began on is still the one the store holds. */
    current(): boolean;
    take(): Promise<unknown>;
}

/* Watches both folders for the file and takes an edit in once its burst settled, in turn with the store's own writes. */
export function watchOutsideEdits(edits: OutsideEdits): { settle: Settled; watchers: DirectoryWatcher[] } {
    const settle = settled(edits.seams, WATCH_SETTLE_MS, () =>
        edits.writes
            .run(async () => {
                if (edits.current()) {
                    await edits.take();
                }
            })
            .catch((e: unknown) => {
                console.warn(`An outside edit to the ${edits.what} of ${edits.folder} could not be taken in:`, errorText(e));
            })
    );
    const watchers = watchDirectories(edits.seams, [join(edits.folder, PROJECT_DIR), join(edits.folder, PROJECT_DIR, PRIVATE_DIR)], (filename) => {
        if (filename === null || filename.endsWith(edits.file)) {
            settle.nudge();
        }
    });
    return { settle, watchers };
}

/* Stops watching a project's files and forgets it; the next read loads it again. */
export function closeLoaded(loaded: Map<string, { watchers: DirectoryWatcher[]; settle?: Settled | null }>, projectId: string): void {
    const state = loaded.get(projectId);

    if (!state) {
        return;
    }

    for (const watcher of state.watchers) {
        watcher.close();
    }

    state.settle?.stop();
    loaded.delete(projectId);
}

/* Takes in each file whose text moved since the store last read or wrote it; true when one did. */
export function takeMovedFiles<State extends { rev: number; sharedText: string; privateText: string }, Shared, Private>(
    state: State,
    shared: JsonDocumentRead<Shared>,
    own: JsonDocumentRead<Private>,
    takeShared: (state: State, read: JsonDocumentRead<Shared>) => void,
    takePrivate: (state: State, read: JsonDocumentRead<Private>) => void
): boolean {
    const sharedText = readTextOf(shared);
    const privateText = readTextOf(own);
    const sharedMoved = sharedText !== null && sharedText !== state.sharedText;
    const privateMoved = privateText !== null && privateText !== state.privateText;
    if (!sharedMoved && !privateMoved) {
        return false;
    }
    const rev = state.rev;
    if (sharedMoved) {
        takeShared(state, shared);
    }
    if (privateMoved) {
        takePrivate(state, own);
    }
    // A pull changes only the shared file, and a save against the rev from before it would write over it.
    state.rev = Math.max(state.rev, rev + 1);
    return true;
}

/* The entries of both files in the order a person keeps; one the order does not name goes after, shared first. The first of an id wins. */
export function inPersonalOrder<T extends { id: string }>(entries: readonly T[], order: readonly string[]): T[] {
    const seen = new Set<string>();
    const unique = entries.filter((entry) => {
        if (seen.has(entry.id)) {
            return false;
        }
        seen.add(entry.id);
        return true;
    });
    const rank = new Map(order.map((id, index) => [id, index]));
    return unique
        .map((entry, index) => ({ entry, index }))
        .sort((a, b) => (rank.get(a.entry.id) ?? order.length + a.index) - (rank.get(b.entry.id) ?? order.length + b.index))
        .map(({ entry }) => entry);
}

export function readSharedFile(path: string): Promise<JsonDocumentRead<SharedFileRead>> {
    return readJsonDocument(path, parseSharedFile);
}

export function parseSharedFile(text: string): JsonDocumentParse<SharedFileRead> {
    const versioned = parseVersioned(text, PROJECT_VERSION);
    if (versioned.kind !== 'value') {
        return versioned;
    }
    const read = migrateSharedFile(versioned.value);
    if (!read) {
        return { kind: 'unreadable' };
    }
    const duplicate = duplicateIdIn(read.file.views);
    if (duplicate) {
        return { kind: 'invalid', message: `Two views or nodes in this project share the id "${duplicate}"` };
    }
    return { kind: 'ok', document: { ...read, file: { ...read.file, views: withoutCrossViewEdges(read.file.views) } } };
}

export function parsePrivateFile(text: string): JsonDocumentParse<ProjectPrivateFile> {
    const versioned = parseVersioned(text, PROJECT_PRIVATE_VERSION);
    if (versioned.kind !== 'value') {
        return versioned;
    }
    const parsed = ProjectPrivateFileSchema.safeParse(versioned.value);
    if (!parsed.success) {
        return { kind: 'unreadable' };
    }
    return { kind: 'ok', document: { ...parsed.data, views: withoutCrossViewEdges(parsed.data.views) } };
}

export function readPrivateFile(path: string, options?: JsonDocumentReadOptions): Promise<JsonDocumentRead<ProjectPrivateFile>> {
    return readJsonDocument(path, parsePrivateFile, options);
}

/*
 * Every node, text, edge and layout of a canvas on a line of its own, so moving a node is one changed
 * line and two people adding one do not collide in a twenty-line block `JSON.stringify` would write.
 */
const INDENT = '  ';

const LINE_PER_ITEM = new Set(['nodes', 'texts', 'edges', 'layouts']);

function itemsOnLines(items: readonly unknown[], indent: string): string {
    return items.length === 0 ? '[]' : `[\n${items.map((item) => `${indent}${INDENT}${JSON.stringify(item)}`).join(',\n')}\n${indent}]`;
}

/* A canvas opened up; every other view is small enough to read on one line. */
function serializeView(view: unknown, indent: string): string {
    if (!isRecord(view) || view.kind !== 'canvas') {
        return `${indent}${JSON.stringify(view)}`;
    }
    const inner = `${indent}${INDENT}`;
    // A field set to undefined is a field taken away, which is how JSON.stringify writes it too.
    const fields = Object.entries(view)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) =>
            LINE_PER_ITEM.has(key) && Array.isArray(value)
                ? `${inner}${JSON.stringify(key)}: ${itemsOnLines(value, inner)}`
                : `${inner}${JSON.stringify(key)}: ${JSON.stringify(value)}`
        );
    return `${indent}{\n${fields.join(',\n')}\n${indent}}`;
}

function nested(value: unknown): string {
    return JSON.stringify(value, null, 2).split('\n').join(`\n${INDENT}`);
}

function viewsOnLines(views: readonly ProjectView[], indent: string): string {
    const stored = storedViewsOf(views);
    return stored.length === 0 ? '[]' : `[\n${stored.map((view) => serializeView(view, `${indent}${INDENT}`)).join(',\n')}\n${indent}]`;
}

export function serializeSharedFile(file: ProjectSharedFile): string {
    const fields = [
        `${INDENT}"version": ${file.version}`,
        `${INDENT}"name": ${JSON.stringify(file.name)}`,
        `${INDENT}"color": ${JSON.stringify(file.color)}`,
        ...(file.icon ? [`${INDENT}"icon": ${JSON.stringify(file.icon)}`] : []),
        `${INDENT}"views": ${viewsOnLines(file.views, INDENT)}`
    ];
    return `{\n${fields.join(',\n')}\n}\n`;
}

export function serializePrivateFile(file: ProjectPrivateFile): string {
    const fields = [
        `${INDENT}"version": ${file.version}`,
        `${INDENT}"rev": ${file.rev}`,
        `${INDENT}"views": ${viewsOnLines(file.views, INDENT)}`,
        `${INDENT}"order": ${itemsOnLines(file.order, INDENT)}`,
        `${INDENT}"overlay": ${nested(file.overlay)}`,
        ...(file.flags ? [`${INDENT}"flags": ${nested(file.flags)}`] : []),
        ...(file.sql ? [`${INDENT}"sql": ${nested(file.sql)}`] : []),
        ...(file.accounts ? [`${INDENT}"accounts": ${nested(file.accounts)}`] : []),
        ...(file.overlayFields ? [`${INDENT}"overlayFields": ${itemsOnLines(file.overlayFields, INDENT)}`] : [])
    ];
    return `{\n${fields.join(',\n')}\n}\n`;
}

export function writePrivateFile(path: string, file: ProjectPrivateFile): Promise<string> {
    return writeJsonDocument(path, file, serializePrivateFile);
}

function toPosix(path: string): string {
    return path.split(sep).join('/');
}

/* Maps the folder of a node or a standalone view; undefined takes the folder away. A node on another machine keeps the folder as that machine knows it. */
function mapCwd<T extends { cwd?: string; machine?: string }>(carrier: T, map: (cwd: string) => string | undefined): T {
    if (!carrier.cwd || carrier.machine !== undefined) {
        return carrier;
    }
    const cwd = map(carrier.cwd);
    if (cwd !== undefined) {
        return { ...carrier, cwd };
    }
    const rest = { ...carrier };
    delete rest.cwd;
    return rest;
}

function mapViews(views: ProjectView[], map: (cwd: string) => string | undefined): ProjectView[] {
    // A design's later chats carry a folder each; an entry this version cannot read goes as it is.
    const mapChats = (chats: readonly Record<string, unknown>[]) => mapDesignChats(chats, (chat) => ({ ...chat, node: mapCwd(chat.node, map) }));
    return views.map((view) => {
        if (isCanvasView(view)) {
            return {
                ...view,
                nodes: view.nodes.map((node: ProjectNode) => {
                    const mapped = mapCwd(node, map);
                    return node.kind === 'design' && node.chats !== undefined ? { ...mapped, chats: mapChats(node.chats) } : mapped;
                })
            };
        }
        if (isDesignView(view) && view.chats !== undefined) {
            return { ...view, node: mapCwd(view.node, map), chats: mapChats(view.chats) };
        }
        // Only a chat, a design and a terminal carry a node; every other view has no folder to map.
        return isChatHostView(view) || view.kind === 'terminal' ? { ...view, node: mapCwd(view.node, map) } : view;
    });
}

/*
 * Paths inside the project folder are stored relative to it, so a clone on another machine
 * resolves them against its own checkout. Anything outside the folder stays absolute.
 */
export function toPortable(content: ProjectContent, folder: string | null): ProjectContent {
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
            return climbsOut(rel) ? cwd : `./${toPosix(rel)}`;
        })
    };
}

/* A relative folder that climbs out of the project is one `toPortable` never writes, so it is somebody else's and goes. */
export function fromPortable<T extends ProjectContent>(content: T, folder: string | null): T {
    if (!folder) {
        return content;
    }
    return {
        ...content,
        views: mapViews(content.views, (cwd) => {
            if (isAbsolute(cwd)) {
                return cwd;
            }
            const resolved = resolve(folder, cwd);
            const rel = relative(folder, resolved);
            return climbsOut(rel) ? undefined : resolved;
        })
    };
}

export function drawingsDirOf(documentPath: string): string {
    return join(dirname(documentPath), DRAWINGS_DIR);
}

export function diagramsDirOf(documentPath: string): string {
    return join(dirname(documentPath), DIAGRAMS_DIR);
}

/* The same two directories under `private/`, where the files of views nobody shared sit. */
export function privateDrawingsDirOf(documentPath: string): string {
    return join(privateDirOf(documentPath), DRAWINGS_DIR);
}

export function privateDiagramsDirOf(documentPath: string): string {
    return join(privateDirOf(documentPath), DIAGRAMS_DIR);
}

/* The view id, never its name: a rename must not move a file, and two machines must agree. */
export function viewFilePathIn(dir: string, viewId: string): string {
    return join(dir, `${encodeURIComponent(viewId)}.json`);
}

export function viewFilePathOf(documentPath: string, kind: 'drawing' | 'diagram', viewId: string, shared: readonly string[]): string {
    const dir = shared.includes(viewId) ? dirname(documentPath) : privateDirOf(documentPath);
    return viewFilePathIn(join(dir, kind === 'drawing' ? DRAWINGS_DIR : DIAGRAMS_DIR), viewId);
}

/* The view a drawing or diagram file belongs to, or null for a name that is not one of ours. */
export function viewIdOfFile(filename: string): string | null {
    if (!filename.endsWith('.json')) {
        return null;
    }
    try {
        const id = decodeURIComponent(filename.slice(0, -'.json'.length));
        return id === '' ? null : id;
    } catch {
        return null;
    }
}

/*
 * Every entry of a list on one line: `JSON.stringify(document, null, 2)` would put every point of
 * every stroke on a line of its own, and a diff of that says nothing.
 */
export function serializeDrawing(document: DrawingDocument): string {
    return ['{', `  "version": ${document.version},`, `  "rev": ${document.rev},`, `  "elements": ${itemsOnLines(document.elements, INDENT)}`, '}', ''].join(
        '\n'
    );
}

function parseDrawing(text: string): JsonDocumentParse<DrawingDocument> {
    const versioned = parseVersioned(text, DRAWING_VERSION);
    if (versioned.kind !== 'value') {
        return versioned;
    }
    const document = migrateDrawing(versioned.value);
    if (!document) {
        // JSON that is not a drawing at all: a person's file under our name, so it stays where it is.
        return { kind: 'invalid', message: 'This file is not a drawing Ruimte can read' };
    }
    const duplicate = duplicateElementIdIn(document.elements);
    if (duplicate) {
        return { kind: 'invalid', message: `Two elements in this drawing share the id "${duplicate}"` };
    }
    return { kind: 'ok', document };
}

export function readDrawing(path: string, options?: JsonDocumentReadOptions): Promise<JsonDocumentRead<DrawingDocument>> {
    return readJsonDocument(path, parseDrawing, options);
}

export function writeDrawing(path: string, document: DrawingDocument): Promise<string> {
    return writeJsonDocument(path, document, serializeDrawing);
}

/* The same shape for a diagram, so a diff names the node, group or edge that was added. */
export function serializeDiagram(document: DiagramDocument): string {
    return [
        '{',
        `  "version": ${document.version},`,
        `  "rev": ${document.rev},`,
        `  "meta": ${JSON.stringify(document.meta)},`,
        `  "nodes": ${itemsOnLines(document.nodes, INDENT)},`,
        `  "groups": ${itemsOnLines(document.groups, INDENT)},`,
        `  "edges": ${itemsOnLines(document.edges, INDENT)}`,
        '}',
        ''
    ].join('\n');
}

function parseDiagram(text: string): JsonDocumentParse<DiagramDocument> {
    const versioned = parseVersioned(text, DIAGRAM_VERSION);
    if (versioned.kind !== 'value') {
        return versioned;
    }
    const document = migrateDiagram(versioned.value);
    if (!document) {
        // JSON that is not a diagram at all: a person's file under our name, so it stays where it is.
        return { kind: 'invalid', message: 'This file is not a diagram Ruimte can read' };
    }
    const problem = diagramProblemIn(document);
    if (problem) {
        return { kind: 'invalid', message: problem };
    }
    return { kind: 'ok', document };
}

export function readDiagram(path: string, options?: JsonDocumentReadOptions): Promise<JsonDocumentRead<DiagramDocument>> {
    return readJsonDocument(path, parseDiagram, options);
}

export function writeDiagram(path: string, document: DiagramDocument): Promise<string> {
    return writeJsonDocument(path, document, serializeDiagram);
}

// What an uploaded icon may be, and what it is called on disk. An `.ico` is a favicon, not
// something a person picks in a file dialog, so it is read but never written.
export const ICON_EXTENSION_BY_MIME: Record<string, string> = {
    'image/svg+xml': 'svg',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif'
};

const ICON_EXTENSIONS = Object.values(ICON_EXTENSION_BY_MIME).concat('jpeg');

function iconPathInFolder(folder: string, extension: string): string {
    return join(folder, PROJECT_DIR, `icon.${extension}`);
}

/* Only one `.ruimte/icon.*` may exist, or the derivation order would decide which one wins. */
export async function removeIconFiles(folder: string): Promise<void> {
    for (const extension of ICON_EXTENSIONS) {
        await rm(iconPathInFolder(folder, extension), { force: true });
    }
}

export async function writeIconFile(folder: string, extension: string, bytes: Uint8Array): Promise<string> {
    const path = iconPathInFolder(folder, extension);
    await mkdir(dirname(path), { recursive: true });
    await removeIconFiles(folder);
    await writeAtomic(path, bytes, 0o644);
    return path;
}
