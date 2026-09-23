import { ActionRefusal, type ActionCall, type ActionHandlers, type ActionInput, type ActionOutput } from '@ruimte/actions';
import {
    DiagramContentSchema,
    diagramProblemIn,
    DrawingContentSchema,
    duplicateElementIdIn,
    isCanvasView,
    isDiagramView,
    isDrawingView,
    type DiagramContent,
    type DiagramNode,
    type DrawingElement,
    type ProjectView
} from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { z } from 'zod';
import { asksFirst } from '@/actions/developer-actions';
import { diagramPng, diagramSvg } from '@/diagram/export';
import { drawingClipboardText, drawingPng, drawingSvg, download, exportFileName, exportTargets } from '@/drawing/export';
import { lineElement, noteElement, shapeElement, textElement } from '@/drawing/gestures';
import { fitTextBox } from '@/drawing/paint';
import { locateView } from '@/shell/split';
import { liveCanvas, nextId, type CanvasState } from '@/state/canvas';
import { defaultDiagrams, type DiagramState } from '@/state/diagram';
import type { DocumentState } from '@/state/document';
import { defaultDrawings, DUPLICATE_OFFSET, isWritten, newSeed, withStyle, type DrawingState, type DrawingStyle } from '@/state/drawing';

type Call = ActionCall<void> & { confirmed: boolean };

/* What the content actions reach outside the document: the clipboard, a save dialog and the painters. */
export interface ContentMachine {
    writeText(text: string): Promise<void>;
    writePng(png: Blob): Promise<void>;
    /* Asks where the file goes; a browser tab downloads it instead. */
    save(blob: Blob, name: string, mime: string): Promise<void>;
    drawingPng(store: StoreApi<DrawingState>): Promise<Blob | null>;
    drawingSvg(store: StoreApi<DrawingState>): string;
    diagramPng(store: StoreApi<DiagramState>): Promise<Blob | null>;
    diagramSvg(store: StoreApi<DiagramState>): string;
}

const clipboard = (): Clipboard => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
        throw new ActionRefusal('no-clipboard', 'This window has no clipboard to copy to.');
    }
    return navigator.clipboard;
};

const LIVE_MACHINE: ContentMachine = {
    writeText: (text) => clipboard().writeText(text),
    writePng: (png) => clipboard().write([new ClipboardItem({ 'image/png': png })]),
    save: download,
    drawingPng: (store) => drawingPng(store),
    drawingSvg: (store) => drawingSvg(store),
    diagramPng,
    diagramSvg
};

/* Past this the words of a note are cut; the rest stays in the note. */
const MAX_NOTE_CHARACTERS = 12_000;
/* A drawing read lists at most this many elements, front ones last, which is what a picture of it shows first. */
const MAX_READ_ELEMENTS = 300;

const isOnScreen = (state: DocumentState, viewId: string): boolean => state.layout !== null && locateView(state.layout, viewId) !== null;

const withLine = (body: string, text: string): string => (body === '' ? text : `${body}${body.endsWith('\n') ? '' : '\n'}${text}`);

const plural = (count: number, noun: string): string => `${count} ${count === 1 ? noun : `${noun}s`}`;

/*
 * The editor of a drawing or a diagram in a cell. Only one on screen holds what a person sees and
 * can undo, so anything else is refused rather than written behind the file's back.
 */
const editorOf = <State>(
    document: StoreApi<DocumentState>,
    viewId: string,
    kind: 'drawing' | 'diagram',
    peek: (viewId: string) => StoreApi<State> | null
): { view: ProjectView; store: StoreApi<State> } => {
    const state = document.getState();
    const view = state.views.find((candidate) => candidate.id === viewId);
    if (!view || !(kind === 'drawing' ? isDrawingView(view) : isDiagramView(view))) {
        throw new ActionRefusal(`unknown-${kind}`, `No ${kind} view with id “${viewId}” exists in this project.`);
    }
    const store = isOnScreen(state, viewId) ? peek(viewId) : null;
    if (store === null) {
        throw new ActionRefusal('inactive-view', `Open “${view.name}” before changing or reading what it holds.`);
    }
    return { view, store };
};

/* A step back through the editor's own history, honest only while nothing came after it. */
const historyUndo =
    <State extends { past: readonly unknown[]; undo(): void }>(store: StoreApi<State>, depth: number, name: string) =>
    () => {
        if (store.getState().past.length !== depth) {
            throw new ActionRefusal('stale-undo', `“${name}” changed after this action, so it cannot be safely undone here.`);
        }
        store.getState().undo();
    };

/* The elements an action names, or what is selected; a locked one stays out of every change but locking. */
const targetsOf = (state: DrawingState, ids: readonly string[] | null | undefined, view: string): string[] => {
    if (ids == null) {
        if (state.selection.length === 0) {
            throw new ActionRefusal('nothing-selected', `Nothing is selected in “${view}”; name the elements by id.`);
        }
        return [...state.selection];
    }
    const known = new Set(state.elements.map((element) => element.id));
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length > 0) {
        throw new ActionRefusal('unknown-element', `“${view}” has no element ${missing.map((id) => `“${id}”`).join(', ')}.`);
    }
    return [...new Set(ids)];
};

type DrawnSpec = NonNullable<ActionInput<'drawing.addElements'>['elements']>[number];

/* A shape of the kind asked for, drawn the way the dock's style would draw it by hand. */
const drawnElement = (spec: DrawnSpec, style: DrawingStyle): DrawingElement => {
    const id = nextId('el');
    const seed = newSeed();
    const rect = { x: Math.min(spec.x, spec.x + spec.w), y: Math.min(spec.y, spec.y + spec.h), w: Math.abs(spec.w), h: Math.abs(spec.h) };
    switch (spec.kind) {
        case 'arrow':
        case 'line': {
            const line = lineElement(spec.kind, { x: spec.x, y: spec.y }, { x: spec.x + spec.w, y: spec.y + spec.h }, style, id, seed);
            return spec.color === null ? line : { ...line, stroke: spec.color };
        }
        case 'text': {
            const text = { ...textElement({ x: spec.x, y: spec.y }, style, id, seed), text: spec.text ?? '', align: style.align } as DrawingElement & {
                kind: 'text';
            };
            const colored = spec.color === null ? text : { ...text, stroke: spec.color };
            return { ...colored, ...fitTextBox(colored) };
        }
        case 'note': {
            const note = { ...noteElement(rect, style, id, seed), text: spec.text ?? '' } as DrawingElement & { kind: 'note' };
            const papered = spec.color === null ? note : { ...note, fillColor: spec.color };
            return { ...papered, ...fitTextBox(papered) };
        }
        default: {
            const shape = shapeElement(spec.kind, rect, style, id, seed)!;
            return spec.color === null ? shape : { ...shape, stroke: spec.color };
        }
    }
};

/* The style fields that were given; null keeps what an element has. */
const givenStyle = (style: ActionInput<'drawing.updateElements'>['style']): Partial<DrawingStyle> =>
    style == null ? {} : (Object.fromEntries(Object.entries(style).filter(([, value]) => value !== null)) as Partial<DrawingStyle>);

const summaryOf = (element: DrawingElement): ActionOutput<'drawing.read'>['elements'][number] => ({
    id: element.id,
    kind: element.kind === 'line' && element.arrowEnd === true ? 'arrow' : element.kind,
    x: Math.round(element.x),
    y: Math.round(element.y),
    w: Math.round(element.w),
    h: Math.round(element.h),
    text: isWritten(element) ? element.text : null,
    color: element.kind === 'note' ? (element.fillColor ?? 'yellow') : element.stroke,
    locked: element.locked === true
});

/* What a JSON document of a drawing or a diagram holds, or a refusal that says what is wrong with it. */
const parsedDocument = <Schema extends z.ZodType>(document: string, schema: Schema, what: string): z.output<Schema> => {
    let json: unknown;
    try {
        json = JSON.parse(document);
    } catch (error: unknown) {
        throw new ActionRefusal('bad-json', `The ${what} is not JSON: ${error instanceof Error ? error.message : 'it does not parse'}.`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
        throw new ActionRefusal('bad-document', `The ${what} does not fit: ${z.prettifyError(parsed.error)}`);
    }
    return parsed.data;
};

const nodeOfDiagram = (state: DiagramState, id: string, view: string): DiagramNode => {
    const node = state.content.nodes.find((candidate) => candidate.id === id);
    if (!node) {
        throw new ActionRefusal('unknown-diagram-node', `“${view}” has no node “${id}”.`);
    }
    return node;
};

const withDiagramNode = (content: DiagramContent, id: string, next: DiagramNode): DiagramContent => ({
    ...content,
    nodes: content.nodes.map((node) => (node.id === id ? next : node))
});

/*
 * What a person does to a note, a drawing and a diagram, as actions: the drawing's keys, menu and
 * dock, the diagram's dock, menus and editors. Each edit is one step in the editor's own history, so
 * undo is that step, refused once anything came after it. A shape still being drawn, a drag, an erase
 * stroke and typing stay with the gesture; what they finish is the element.
 */
export function contentActions(document: StoreApi<DocumentState>, overrides: Partial<ContentMachine> = {}): ActionHandlers<void> {
    const machine: ContentMachine = { ...LIVE_MACHINE, ...overrides };

    const drawing = (viewId: string) => editorOf<DrawingState>(document, viewId, 'drawing', (id) => defaultDrawings.peek(id));
    const diagram = (viewId: string) => editorOf<DiagramState>(document, viewId, 'diagram', (id) => defaultDiagrams.peek(id));

    const noteOf = (viewId: string, nodeId: string) => {
        const view = document
            .getState()
            .exportViews()
            .find((candidate) => candidate.id === viewId);
        if (!view || !isCanvasView(view)) {
            throw new ActionRefusal('unknown-view', `No canvas view with id “${viewId}” exists in this project.`);
        }
        const node = view.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) {
            throw new ActionRefusal('unknown-node', `No node with id “${nodeId}” exists on “${view.name}”.`);
        }
        if (node.kind !== 'note') {
            throw new ActionRefusal('not-a-note', `“${node.title}” is a ${node.kind} node, and only a note holds words to write.`);
        }
        return { view, node };
    };

    /* One history step over the elements, with the undo that takes exactly that step back. */
    const edited = (store: StoreApi<DrawingState>, view: string, next: DrawingElement[], elementIds: string[], viewId: string) => {
        const depth = store.getState().past.length;
        store.getState().replaceElements(next);
        return { output: { viewId, view, elementIds }, undo: historyUndo(store, depth + 1, view) };
    };

    const copied = async (format: 'png' | 'svg', png: () => Promise<Blob | null>, svg: () => string): Promise<void> => {
        if (format === 'svg') {
            await machine.writeText(svg());
            return;
        }
        const blob = await png();
        if (blob === null) {
            throw new ActionRefusal('empty', 'There is nothing to put in a picture.');
        }
        await machine.writePng(blob);
    };

    const saved = async (prefix: string, format: 'png' | 'svg', png: () => Promise<Blob | null>, svg: () => string): Promise<void> => {
        const blob = format === 'svg' ? new Blob([svg()], { type: 'image/svg+xml' }) : await png();
        if (blob === null) {
            throw new ActionRefusal('empty', 'There is nothing to put in a picture.');
        }
        await machine.save(blob, exportFileName(prefix, format), format === 'svg' ? 'image/svg+xml' : 'image/png');
    };

    return {
        'note.read': ({ viewId, nodeId }) => {
            const { node } = noteOf(viewId, nodeId);
            const body = node.body ?? '';
            return {
                output: { viewId, nodeId, note: node.title, text: body.slice(0, MAX_NOTE_CHARACTERS), truncated: body.length > MAX_NOTE_CHARACTERS }
            };
        },
        'node.update': ({ viewId, nodeId, text, append }) => {
            const { view } = noteOf(viewId, nodeId);
            const canvas = isOnScreen(document.getState(), viewId) ? liveCanvas(viewId) : null;
            if (canvas === null) {
                throw new ActionRefusal('inactive-canvas', `Open “${view.name}” before writing in its notes.`);
            }
            if (append && text === '') {
                throw new ActionRefusal('empty-text', 'There is nothing to add under the note.');
            }
            const body = canvas.nodes[nodeId]?.body ?? '';
            const next = append ? withLine(body, text) : text;
            const output = { viewId, nodeId, lines: next === '' ? 0 : next.split('\n').length, characters: next.length, changed: next !== body };
            if (next === body) {
                return { output };
            }
            const depth = canvas.past.length;
            canvas.updateNode(nodeId, { body: next }, true);
            return {
                output,
                undo: () => {
                    const current: CanvasState | null = liveCanvas(viewId);
                    if (current === null || current.past.length !== depth + 1 || current.nodes[nodeId]?.body !== next) {
                        throw new ActionRefusal('stale-undo', 'The note changed after this was written, so it cannot be safely undone here.');
                    }
                    current.undo();
                }
            };
        },
        'drawing.read': ({ viewId }) => {
            const { view, store } = drawing(viewId);
            const { elements, selection } = store.getState();
            return {
                output: {
                    viewId,
                    view: view.name ?? viewId,
                    elements: elements.slice(-MAX_READ_ELEMENTS).map(summaryOf),
                    selected: [...selection],
                    truncated: elements.length > MAX_READ_ELEMENTS
                }
            };
        },
        'drawing.addElements': ({ viewId, elements, copies }) => {
            const { view, store } = drawing(viewId);
            const state = store.getState();
            const added =
                copies != null
                    ? copies.map((element) => ({
                          ...element,
                          id: nextId('el'),
                          x: element.x + DUPLICATE_OFFSET,
                          y: element.y + DUPLICATE_OFFSET,
                          seed: newSeed()
                      }))
                    : (elements ?? []).map((spec) => drawnElement(spec, state.style));
            if (added.length === 0) {
                throw new ActionRefusal('nothing-to-draw', 'Name at least one element to draw.');
            }
            const ids = added.map((element) => element.id);
            const result = edited(store, view.name ?? viewId, [...state.elements, ...added], ids, viewId);
            store.getState().select(ids);
            return result;
        },
        'drawing.updateElements': ({ viewId, elementIds, style, text, dx, dy }) => {
            const { view, store } = drawing(viewId);
            const patch = givenStyle(style);
            const moves = (dx ?? 0) !== 0 || (dy ?? 0) !== 0;
            if (Object.keys(patch).length === 0 && text == null && !moves) {
                throw new ActionRefusal('nothing-to-change', 'Name a style, a text or a move.');
            }
            const state = store.getState();
            // Without elements a style is also what the next element is drawn with, the way the dock sets it.
            if (elementIds == null && Object.keys(patch).length > 0) {
                store.setState({ style: { ...state.style, ...patch } });
            }
            if (elementIds == null && state.selection.length === 0 && text == null && !moves) {
                return { output: { viewId, view: view.name ?? viewId, elementIds: [] } };
            }
            const targets = new Set(targetsOf(state, elementIds, view.name ?? viewId));
            const changedIds: string[] = [];
            const next = state.elements.map((element) => {
                if (!targets.has(element.id) || element.locked) {
                    return element;
                }
                let changed = Object.keys(patch).length > 0 ? withStyle(element, patch) : element;
                if (text != null && isWritten(changed)) {
                    changed = { ...changed, text };
                    changed = { ...changed, ...fitTextBox(changed as DrawingElement & { kind: 'text' | 'note' }) };
                }
                if (moves) {
                    changed = { ...changed, x: changed.x + (dx ?? 0), y: changed.y + (dy ?? 0) };
                }
                if (changed !== element) {
                    changedIds.push(element.id);
                }
                return changed;
            });
            if (changedIds.length === 0) {
                return { output: { viewId, view: view.name ?? viewId, elementIds: [] } };
            }
            return edited(store, view.name ?? viewId, next, changedIds, viewId);
        },
        'drawing.deleteElements': ({ viewId, elementIds }) => {
            const { view, store } = drawing(viewId);
            const state = store.getState();
            const targets = new Set(targetsOf(state, elementIds, view.name ?? viewId));
            const gone = state.elements.filter((element) => targets.has(element.id) && !element.locked).map((element) => element.id);
            if (gone.length === 0) {
                return { output: { viewId, view: view.name ?? viewId, elementIds: [] } };
            }
            const result = edited(
                store,
                view.name ?? viewId,
                state.elements.filter((element) => !gone.includes(element.id)),
                gone,
                viewId
            );
            store.setState({ selection: store.getState().selection.filter((id) => !gone.includes(id)), editingTextId: null });
            return result;
        },
        'drawing.duplicateElements': ({ viewId, elementIds }) => {
            const { view, store } = drawing(viewId);
            const state = store.getState();
            const targets = new Set(targetsOf(state, elementIds, view.name ?? viewId));
            const copies = state.elements
                .filter((element) => targets.has(element.id))
                .map((element) => ({ ...element, id: nextId('el'), x: element.x + DUPLICATE_OFFSET, y: element.y + DUPLICATE_OFFSET, seed: newSeed() }));
            const ids = copies.map((element) => element.id);
            const result = edited(store, view.name ?? viewId, [...state.elements, ...copies], ids, viewId);
            store.getState().select(ids);
            return result;
        },
        'drawing.reorderElements': ({ viewId, elementIds, to }) => {
            const { view, store } = drawing(viewId);
            const state = store.getState();
            const targets = new Set(targetsOf(state, elementIds, view.name ?? viewId));
            const moving = state.elements.filter((element) => targets.has(element.id));
            const staying = state.elements.filter((element) => !targets.has(element.id));
            return edited(store, view.name ?? viewId, to === 'front' ? [...staying, ...moving] : [...moving, ...staying], [...targets], viewId);
        },
        'drawing.lockElements': ({ viewId, elementIds, locked }) => {
            const { view, store } = drawing(viewId);
            const state = store.getState();
            const targets = new Set(targetsOf(state, elementIds, view.name ?? viewId));
            const flipped = state.elements.filter((element) => targets.has(element.id) && (element.locked === true) !== locked).map((element) => element.id);
            if (flipped.length === 0) {
                return { output: { viewId, view: view.name ?? viewId, elementIds: [] } };
            }
            const next = state.elements.map((element) => {
                if (!flipped.includes(element.id)) {
                    return element;
                }
                if (locked) {
                    return { ...element, locked: true };
                }
                const { locked: _locked, ...open } = element;
                return open as DrawingElement;
            });
            const result = edited(store, view.name ?? viewId, next, flipped, viewId);
            // A locked element cannot be picked up again, so the selection lets go of it.
            if (locked) {
                store.setState({ selection: store.getState().selection.filter((id) => !flipped.includes(id)) });
            }
            return result;
        },
        'drawing.replaceContent': ({ viewId, document: json }, call: Call) => {
            const { view, store } = drawing(viewId);
            const content = parsedDocument(json, DrawingContentSchema, 'drawing');
            const repeated = duplicateElementIdIn(content.elements);
            if (repeated !== null) {
                throw new ActionRefusal('bad-document', `Two elements share the id “${repeated}”.`);
            }
            const name = view.name ?? viewId;
            if (asksFirst(call)) {
                return {
                    confirmation: {
                        title: `Replace everything in the drawing “${name}”?`,
                        consequences: [
                            `The ${plural(store.getState().elements.length, 'element')} it holds now are replaced by ${plural(content.elements.length, 'element')}.`,
                            'Undo brings them back while the drawing stays open.'
                        ]
                    }
                };
            }
            const depth = store.getState().past.length;
            store.getState().replaceElements(content.elements);
            store.setState({ selection: [], editingTextId: null });
            return { output: { viewId, view: name, elements: content.elements.length }, undo: historyUndo(store, depth + 1, name) };
        },
        'drawing.copy': async ({ viewId, format }) => {
            const { view, store } = drawing(viewId);
            const targets = exportTargets(store);
            if (targets.length === 0) {
                throw new ActionRefusal('empty', `“${view.name}” has nothing to copy.`);
            }
            if (format === 'elements') {
                const selected = store.getState().elements.filter((element) => store.getState().selection.includes(element.id));
                if (selected.length === 0) {
                    throw new ActionRefusal('nothing-selected', `Nothing is selected in “${view.name}” to copy as elements.`);
                }
                await machine.writeText(drawingClipboardText(selected));
                return { output: { viewId, view: view.name ?? viewId, format, elements: selected.length } };
            }
            await copied(
                format,
                () => machine.drawingPng(store),
                () => machine.drawingSvg(store)
            );
            return { output: { viewId, view: view.name ?? viewId, format, elements: targets.length } };
        },
        'drawing.export': async ({ viewId, format }) => {
            const { view, store } = drawing(viewId);
            if (exportTargets(store).length === 0) {
                throw new ActionRefusal('empty', `“${view.name}” has nothing to save.`);
            }
            await saved(
                'drawing',
                format,
                () => machine.drawingPng(store),
                () => machine.drawingSvg(store)
            );
            return { output: { viewId, view: view.name ?? viewId, format } };
        },
        'diagram.read': ({ viewId }) => {
            const { view, store } = diagram(viewId);
            const { content } = store.getState();
            return {
                output: {
                    viewId,
                    view: view.name ?? viewId,
                    title: content.meta.title,
                    direction: content.meta.direction,
                    nodes: content.nodes.map((node) => ({
                        id: node.id,
                        label: node.label,
                        shape: node.shape ?? null,
                        tone: node.tone ?? null,
                        pinned: node.pos !== undefined
                    })),
                    groups: content.groups.map((group) => ({ id: group.id, label: group.label, wraps: [...group.wraps] })),
                    edges: content.edges.map((edge) => ({ from: edge.from, to: edge.to, label: edge.label ?? null }))
                }
            };
        },
        'diagram.replaceContent': ({ viewId, document: json }, call: Call) => {
            const { view, store } = diagram(viewId);
            const content = parsedDocument(json, DiagramContentSchema, 'diagram');
            const problem = diagramProblemIn(content);
            if (problem !== null) {
                throw new ActionRefusal('bad-document', problem);
            }
            const name = view.name ?? viewId;
            const current = store.getState().content;
            if (asksFirst(call)) {
                return {
                    confirmation: {
                        title: `Replace everything in the diagram “${name}”?`,
                        consequences: [
                            `Its ${plural(current.nodes.length, 'node')}, ${plural(current.groups.length, 'group')} and ${plural(current.edges.length, 'edge')} are replaced, and every node a person placed by hand goes back to the layout unless the new document places it.`,
                            'Undo brings them back while the diagram stays open.'
                        ]
                    }
                };
            }
            const depth = store.getState().past.length;
            store.getState().replaceContent(content);
            return {
                output: { viewId, rev: store.getState().rev, nodes: content.nodes.length, groups: content.groups.length, edges: content.edges.length },
                undo: historyUndo(store, depth + 1, name)
            };
        },
        'diagram.updateNode': ({ viewId, diagramNodeId, label, tone }) => {
            const { view, store } = diagram(viewId);
            const name = view.name ?? viewId;
            if (label == null && tone == null) {
                throw new ActionRefusal('nothing-to-change', 'Name a new label or a new color.');
            }
            const state = store.getState();
            const node = nodeOfDiagram(state, diagramNodeId, name);
            const next: DiagramNode = { ...node, ...(label == null ? {} : { label }), ...(tone == null ? {} : { tone }) };
            if (next.label === node.label && next.tone === node.tone) {
                return { output: { viewId, view: name, diagramNodeId, label: node.label, changed: false } };
            }
            const depth = state.past.length;
            state.replaceContent(withDiagramNode(state.content, diagramNodeId, next));
            return { output: { viewId, view: name, diagramNodeId, label: next.label, changed: true }, undo: historyUndo(store, depth + 1, name) };
        },
        'diagram.resetPosition': ({ viewId, diagramNodeId }) => {
            const { view, store } = diagram(viewId);
            const name = view.name ?? viewId;
            const state = store.getState();
            const node = nodeOfDiagram(state, diagramNodeId, name);
            if (node.pos === undefined) {
                return { output: { viewId, view: name, diagramNodeId, label: node.label, changed: false } };
            }
            const depth = state.past.length;
            state.resetPosition(diagramNodeId);
            return { output: { viewId, view: name, diagramNodeId, label: node.label, changed: true }, undo: historyUndo(store, depth + 1, name) };
        },
        'diagram.copy': async ({ viewId, format }) => {
            const { view, store } = diagram(viewId);
            const { content } = store.getState();
            if (format === 'json') {
                // The graph without its rev, which is what a person pastes into a chat to talk about it.
                await machine.writeText(`${JSON.stringify(content, null, 2)}\n`);
                return { output: { viewId, view: view.name ?? viewId, format } };
            }
            if (content.nodes.length === 0) {
                throw new ActionRefusal('empty', `“${view.name}” has nothing to copy.`);
            }
            await copied(
                format,
                () => machine.diagramPng(store),
                () => machine.diagramSvg(store)
            );
            return { output: { viewId, view: view.name ?? viewId, format } };
        },
        'diagram.export': async ({ viewId, format }) => {
            const { view, store } = diagram(viewId);
            if (store.getState().content.nodes.length === 0) {
                throw new ActionRefusal('empty', `“${view.name}” has nothing to save.`);
            }
            await saved(
                'diagram',
                format,
                () => machine.diagramPng(store),
                () => machine.diagramSvg(store)
            );
            return { output: { viewId, view: view.name ?? viewId, format } };
        }
    };
}
