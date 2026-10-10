import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
    DIAGRAM_VERSION,
    DRAWING_VERSION,
    PROJECT_PRIVATE_VERSION,
    PROJECT_VERSION,
    ProjectPrivateFileSchema,
    diagramProblemIn,
    duplicateElementIdIn,
    duplicateIdIn,
    isCanvasView,
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
    type SharedFileRead
} from '@ruimte/contracts';
import { fileExists, isNotFound, writeAtomic } from '@adecore/agents/fs';

export const PROJECT_DIR = '.ruimte';
export const PROJECT_FILE = 'project.json';
/* The mirror of `.ruimte` that holds what belongs to one person. The `.gitignore` beside it names this one line. */
export const PRIVATE_DIR = 'private';
export const GITIGNORE_FILE = '.gitignore';
// One file per drawing view, in a directory of their own: `.ruimte` is read by people and by git,
// and its top level stays the two files the daemon documents.
export const DRAWINGS_DIR = 'drawings';
// The same rule for diagrams, in a directory beside it, so a file name never says which kind it is.
export const DIAGRAMS_DIR = 'diagrams';
// A person's database consoles, plain `.sql` files under `private`, so git never sees them.
export const CONSOLES_DIR = 'consoles';

/*
 * Whether a path inside a project folder, as the names below that folder, is Ruimte's own state, which a
 * file request never writes, creates, moves or deletes: the files there change only through their own
 * requests and revs. A person's consoles are the exception, since they are files like any other.
 */
export function isRuimteState(segments: readonly string[]): boolean {
    if (segments[0] !== PROJECT_DIR) {
        return false;
    }
    return !(segments[1] === PRIVATE_DIR && segments[2] === CONSOLES_DIR && segments.length > 3);
}

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
 * is moved next to itself with a timestamp, so a bad merge or a crash never costs the person their
 * work and never gets written over by a fresh file. One that parses but breaks an invariant stays
 * where it is: only a person can decide which of the two things sharing an id was meant. One from a
 * newer Ruimte stays too, and untouched: a file a later release reads is not a file to move aside.
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
    await rename(path, setAside);
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
function parseVersioned(text: string, known: number): { kind: 'value'; value: unknown } | JsonDocumentParse<never> {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return { kind: 'unreadable' };
    }
    const newer = newerVersionIn(value, known);
    return newer === null ? { kind: 'value', value } : { kind: 'too-new', version: newer };
}

/* Reads `.ruimte/project.json` on any version there has been. */
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

export function readPrivateFile(path: string): Promise<JsonDocumentRead<ProjectPrivateFile>> {
    return readJsonDocument(path, parsePrivateFile);
}

/*
 * Every node, text, edge and layout of a canvas on a line of its own, so moving a node is one changed
 * line and two people adding one do not collide in a twenty-line block `JSON.stringify` would write.
 */
const INDENT = '  ';

const LINE_PER_ITEM = new Set(['nodes', 'texts', 'edges', 'layouts']);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

/* A nested object pretty-printed, indented to sit one level into the file. */
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
        ...(file.sql ? [`${INDENT}"sql": ${nested(file.sql)}`] : [])
    ];
    return `{\n${fields.join(',\n')}\n}\n`;
}

export function writePrivateFile(path: string, file: ProjectPrivateFile): Promise<string> {
    return writeJsonDocument(path, file, serializePrivateFile);
}

function toPosix(path: string): string {
    return path.split(sep).join('/');
}

/* Maps the folder of a node or a standalone view; undefined takes the folder away. */
function mapCwd<T extends { cwd?: string }>(carrier: T, map: (cwd: string) => string | undefined): T {
    if (!carrier.cwd) {
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
    return views.map((view) => {
        if (isCanvasView(view)) {
            return { ...view, nodes: view.nodes.map((node: ProjectNode) => mapCwd(node, map)) };
        }
        // Only a chat and a terminal carry a node; every other view has no folder to map.
        return view.kind === 'chat' || view.kind === 'terminal' ? { ...view, node: mapCwd(view.node, map) } : view;
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

/* Whether a path `relative` gave leaves the folder it was taken from; a folder named `..cache` does not. */
export function climbsOut(rel: string): boolean {
    return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
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
 * The top level indented, every entry of a list on one line. `JSON.stringify(document, null, 2)`
 * would put every point of every stroke on a line of its own, and a diff of that says nothing.
 */
function oneItemPerLine(items: readonly unknown[]): string {
    return items.length === 0 ? '[]' : `[\n${items.map((item) => `    ${JSON.stringify(item)}`).join(',\n')}\n  ]`;
}

export function serializeDrawing(document: DrawingDocument): string {
    return ['{', `  "version": ${document.version},`, `  "rev": ${document.rev},`, `  "elements": ${oneItemPerLine(document.elements)}`, '}', ''].join('\n');
}

export function parseDrawing(text: string): JsonDocumentParse<DrawingDocument> {
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
        `  "nodes": ${oneItemPerLine(document.nodes)},`,
        `  "groups": ${oneItemPerLine(document.groups)},`,
        `  "edges": ${oneItemPerLine(document.edges)}`,
        '}',
        ''
    ].join('\n');
}

export function parseDiagram(text: string): JsonDocumentParse<DiagramDocument> {
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
    'image/webp': 'webp'
};

const ICON_EXTENSIONS = Object.values(ICON_EXTENSION_BY_MIME).concat('jpeg');

export function iconPathInFolder(folder: string, extension: string): string {
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
