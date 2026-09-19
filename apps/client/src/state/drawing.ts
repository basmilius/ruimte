import { createStore, type StoreApi } from 'zustand';
import { editorBindings } from '@/state/editor-bindings';
import { createEditorRegistry } from '@/state/editors';
import { mergeSelection } from '@/state/selection';
import type {
    DrawingColor,
    DrawingContent,
    DrawingDocument,
    DrawingElement,
    DrawingFill,
    DrawingAlign,
    DrawingFont,
    DrawingRoughness,
    DrawingStrokeStyle,
    DrawingStrokeWidth,
    ProjectViewLocal
} from '@ruimte/contracts';
import { cameraOfView, intersects, type Rect } from '@/canvas/math';
import { createCameraSlice, type CameraSlice } from '@/canvas/camera-slice';
import { boundsOfElements } from '@ruimte/drawing';
import { fitTextBox } from '@/drawing/paint';
import { nextId } from '@/state/canvas';

/* Every tool in the dock, in the order the dock lists them. */
export type DrawingTool = 'select' | 'hand' | 'rect' | 'diamond' | 'ellipse' | 'arrow' | 'line' | 'freehand' | 'text' | 'note' | 'eraser';

/* The tools that make an element by dragging; after one the tool goes back to select unless locked. */
export const isShapeTool = (tool: DrawingTool): boolean => tool !== 'select' && tool !== 'hand' && tool !== 'eraser';

/* What the next element is drawn with. The last choice stays for the session and never enters the file. */
export interface DrawingStyle {
    stroke: DrawingColor;
    strokeWidth: DrawingStrokeWidth;
    strokeStyle: DrawingStrokeStyle;
    fill: DrawingFill;
    fillColor: DrawingColor;
    roughness: DrawingRoughness;
    font: DrawingFont;
    /* Text size in whole pixels, world units like everything else. */
    textSize: number;
    align: DrawingAlign;
    /* The paper of a sticky note, which is its own choice: a note is never filled like a shape. */
    noteColor: DrawingColor;
}

export const DEFAULT_STYLE: DrawingStyle = {
    stroke: 'ink',
    strokeWidth: 2,
    strokeStyle: 'solid',
    fill: 'none',
    fillColor: 'blue',
    roughness: 1,
    font: 'hand',
    textSize: 20,
    align: 'left',
    noteColor: 'yellow'
};

export const HISTORY_LIMIT = 100;

/* Where a duplicate lands, and how far an arrow key moves a selection. */
export const DUPLICATE_OFFSET = 16;

export interface DrawingState extends CameraSlice {
    /* The drawing view this store holds, or null while none is on screen. */
    viewId: string | null;
    /* In stacking order, back to front, the way the file lists them. */
    elements: DrawingElement[];
    selection: string[];
    tool: DrawingTool;
    /* Q: the tool stays after a shape instead of falling back to select. */
    toolLocked: boolean;
    style: DrawingStyle;
    /* The element being drawn right now. It is not in `elements`, so nothing is dirty until it is. */
    draft: DrawingElement | null;
    /* What the eraser has run over in this drag; they go together as one step on pointer up. */
    erasing: string[];
    editingTextId: string | null;
    rev: number;
    dirty: boolean;
    /* Counts changes to the elements, which is what the client saves on. */
    edits: number;
    loading: boolean;
    conflict: DrawingDocument | null;
    error: string | null;
    past: DrawingElement[][];
    future: DrawingElement[][];
    /* Whether an export paints the paper behind the drawing or leaves it transparent. */
    exportBackground: boolean;

    load(viewId: string, document: DrawingDocument, local: ProjectViewLocal | null): void;
    /* Takes the drawing off screen without saving; the client flushes before it calls this. */
    unload(): void;
    exportContent(): DrawingContent;

    /* `additive` is shift: what is already selected stays, and something clicked again drops out. */
    select(ids: string[], additive?: boolean): void;
    selectAll(): void;
    clearSelection(): void;
    /* A box only ever adds, since dragging one across what is selected must not clear it. */
    selectInRect(rect: Rect, additive?: boolean): void;

    setTool(tool: DrawingTool): void;
    toggleToolLock(): void;
    /* A style choice paints the selection and becomes what the next element is drawn with. */
    setStyle(patch: Partial<DrawingStyle>): void;
    /* After a shape the tool falls back to select, unless it is locked or freehand. */
    settleTool(): void;

    beginDraft(element: DrawingElement): void;
    updateDraft(patch: Partial<DrawingElement>): void;
    commitDraft(): string | null;
    cancelDraft(): void;
    addElement(element: DrawingElement): void;

    /* `first` says this is the first step of a gesture, which is the one that goes into the history. */
    moveSelected(dx: number, dy: number, first?: boolean): void;
    replaceElements(next: DrawingElement[], first?: boolean): void;
    updateElement(id: string, patch: Partial<DrawingElement>, first?: boolean): void;

    deleteSelected(): void;
    duplicateSelected(): void;
    /* Elements from the clipboard: they arrive under new ids and seeds, as a duplicate does. */
    pasteElements(elements: DrawingElement[]): void;
    setExportBackground(on: boolean): void;
    bringToFront(): void;
    sendToBack(): void;
    toggleLockSelected(): void;
    unlockAll(): void;

    setEditingText(id: string | null): void;
    updateText(id: string, text: string): void;

    beginErase(): void;
    eraseElement(id: string): void;
    commitErase(): void;

    undo(): void;
    redo(): void;

    setRev(rev: number): void;
    setDirty(dirty: boolean): void;
    setConflict(conflict: DrawingDocument | null): void;
    setError(error: string | null): void;
    /* What the incoming document replaces, keeping the camera, the tool and what still exists. */
    applyDocument(document: DrawingDocument): void;
}

export const boundsOf = (elements: readonly DrawingElement[]): Rect | null => boundsOfElements(elements);

const remember = (state: DrawingState): Pick<DrawingState, 'past' | 'future'> => ({
    past: [...state.past.slice(-(HISTORY_LIMIT - 1)), state.elements],
    future: []
});

/* Every change to the elements is an edit; the client saves on the counter, not on the array. */
const changed = (state: DrawingState, elements: DrawingElement[], first = true): Partial<DrawingState> => ({
    elements,
    edits: state.edits + 1,
    ...(first ? remember(state) : {})
});

/* The style of one element, which is what the dock shows while it is the only thing selected. */
export const styleOfElement = (element: DrawingElement): Partial<DrawingStyle> => ({
    stroke: element.stroke,
    strokeWidth: element.strokeWidth,
    ...(element.strokeStyle ? { strokeStyle: element.strokeStyle } : {}),
    ...(element.kind === 'note'
        ? { noteColor: element.fillColor ?? DEFAULT_STYLE.noteColor }
        : { ...(element.fill ? { fill: element.fill } : {}), ...(element.fillColor ? { fillColor: element.fillColor } : {}) }),
    roughness: element.roughness ?? 1,
    ...(isWritten(element) ? { font: element.font ?? 'hand', textSize: element.size, align: element.align ?? 'left' } : {})
});

/* An element that carries its own words: a written line, or the note it is written on. */
export const isWritten = (element: DrawingElement): element is DrawingElement & { kind: 'text' | 'note' } => element.kind === 'text' || element.kind === 'note';

/* What a style choice writes onto an element: only the field that was chosen, so picking an
   alignment leaves a color the dock happens to show alone. */
const withStyle = (element: DrawingElement, patch: Partial<DrawingStyle>): DrawingElement => {
    const next: DrawingElement = {
        ...element,
        ...(patch.stroke !== undefined ? { stroke: patch.stroke } : {}),
        ...(patch.strokeWidth !== undefined ? { strokeWidth: patch.strokeWidth } : {}),
        ...(patch.strokeStyle !== undefined ? { strokeStyle: patch.strokeStyle } : {}),
        // The paper of a note is picked in the note's own row, never in the fill of a shape.
        ...(element.kind === 'note'
            ? { ...(patch.noteColor !== undefined ? { fillColor: patch.noteColor } : {}) }
            : {
                  ...(patch.fill !== undefined ? { fill: patch.fill } : {}),
                  ...(patch.fillColor !== undefined ? { fillColor: patch.fillColor } : {})
              }),
        ...(patch.roughness !== undefined ? { roughness: patch.roughness } : {})
    };
    if (!isWritten(next)) {
        return next;
    }
    const text = {
        ...next,
        ...(patch.font !== undefined ? { font: patch.font } : {}),
        ...(patch.align !== undefined ? { align: patch.align } : {}),
        ...(patch.textSize !== undefined ? { size: patch.textSize } : {})
    };
    // New glyphs need a new box, or the text would spill out of the frame that selects it.
    return patch.textSize === undefined && patch.font === undefined ? text : { ...text, ...fitTextBox(text) };
};

/*
 * The drawing on screen: its elements, what is selected, which tool is up and where the camera is.
 * Shaped after `useCanvas`, which it cannot reuse: that store is the editor of a canvas view and
 * the session lifecycle reads its nodes.
 */
export const createDrawingStore = (): StoreApi<DrawingState> =>
    createStore<DrawingState>((set, get) => ({
        ...createCameraSlice<DrawingState>(set, get, {
            boundsOfAll: (state) => boundsOf(state.elements),
            boundsOfSelection: (state) => boundsOf(state.elements.filter((element) => state.selection.includes(element.id)))
        }),

        viewId: null,
        elements: [],
        selection: [],
        tool: 'select',
        toolLocked: false,
        style: DEFAULT_STYLE,
        draft: null,
        erasing: [],
        editingTextId: null,
        rev: 0,
        dirty: false,
        edits: 0,
        loading: false,
        conflict: null,
        error: null,
        past: [],
        future: [],
        exportBackground: true,

        load(viewId, document, local) {
            set({
                loading: true,
                viewId,
                elements: document.elements,
                rev: document.rev,
                dirty: false,
                edits: 0,
                conflict: null,
                error: null,
                selection: [],
                draft: null,
                erasing: [],
                editingTextId: null,
                past: [],
                future: [],
                pendingCamera: null
            });
            const stored = local?.camera ?? null;
            const camera = stored === null ? null : cameraOfView(stored, get().viewport);
            if (stored !== null) {
                set(camera === null ? { pendingCamera: { kind: 'view', view: stored } } : { camera });
            }
            set({ loading: false });
            if (stored === null) {
                get().fitAll();
            }
        },

        unload() {
            set({
                viewId: null,
                elements: [],
                selection: [],
                draft: null,
                erasing: [],
                editingTextId: null,
                rev: 0,
                dirty: false,
                edits: 0,
                conflict: null,
                error: null,
                past: [],
                future: []
            });
        },

        exportContent() {
            return { elements: get().elements };
        },

        select(ids, additive = false) {
            set((state) => ({ selection: mergeSelection(state.selection, ids, additive ? 'toggle' : 'replace') }));
        },
        selectAll() {
            set((state) => ({ selection: state.elements.filter((element) => !element.locked).map((element) => element.id) }));
        },
        clearSelection() {
            set({ selection: [] });
        },
        selectInRect(rect, additive = false) {
            const hit = get()
                .elements.filter((element) => !element.locked && intersects(element, rect))
                .map((element) => element.id);
            set((state) => ({ selection: mergeSelection(state.selection, hit, additive ? 'add' : 'replace') }));
        },

        setTool(tool) {
            set({ tool, ...(tool === 'select' ? {} : { editingTextId: null }) });
        },
        toggleToolLock() {
            set((state) => ({ toolLocked: !state.toolLocked }));
        },
        setStyle(patch) {
            const state = get();
            const style = { ...state.style, ...patch };
            const selected = new Set(state.selection);
            if (selected.size === 0) {
                set({ style });
                return;
            }
            const elements = state.elements.map((element) => (selected.has(element.id) && !element.locked ? withStyle(element, patch) : element));
            set({ style, ...changed(state, elements) });
        },
        settleTool() {
            const { tool, toolLocked } = get();
            // Freehand is the one tool that stays: a sketch is a run of strokes, not one.
            if (!toolLocked && isShapeTool(tool) && tool !== 'freehand') {
                set({ tool: 'select' });
            }
        },

        beginDraft(element) {
            set({ draft: element });
        },
        updateDraft(patch) {
            set((state) => (state.draft ? { draft: { ...state.draft, ...patch } as DrawingElement } : {}));
        },
        commitDraft() {
            const state = get();
            const draft = state.draft;
            if (!draft) {
                return null;
            }
            set({ draft: null, selection: [draft.id], ...changed(state, [...state.elements, draft]) });
            return draft.id;
        },
        cancelDraft() {
            set({ draft: null });
        },
        addElement(element) {
            const state = get();
            set({ selection: [element.id], ...changed(state, [...state.elements, element]) });
        },

        moveSelected(dx, dy, first = true) {
            const state = get();
            const selected = new Set(state.selection);
            const elements = state.elements.map((element) =>
                selected.has(element.id) && !element.locked ? { ...element, x: element.x + dx, y: element.y + dy } : element
            );
            set(changed(state, elements, first));
        },
        replaceElements(next, first = true) {
            const state = get();
            set(changed(state, next, first));
        },
        updateElement(id, patch, first = true) {
            const state = get();
            const elements = state.elements.map((element) => (element.id === id ? ({ ...element, ...patch } as DrawingElement) : element));
            set(changed(state, elements, first));
        },

        deleteSelected() {
            const state = get();
            const selected = new Set(state.selection);
            const elements = state.elements.filter((element) => !selected.has(element.id) || element.locked);
            if (elements.length === state.elements.length) {
                return;
            }
            set({ selection: [], editingTextId: null, ...changed(state, elements) });
        },
        duplicateSelected() {
            const state = get();
            const selected = new Set(state.selection);
            const copies = state.elements
                .filter((element) => selected.has(element.id))
                .map((element) => ({
                    ...element,
                    id: nextId('el'),
                    x: element.x + DUPLICATE_OFFSET,
                    y: element.y + DUPLICATE_OFFSET,
                    seed: newSeed()
                }));
            if (copies.length === 0) {
                return;
            }
            set({ selection: copies.map((element) => element.id), ...changed(state, [...state.elements, ...copies]) });
        },
        pasteElements(elements) {
            if (elements.length === 0) {
                return;
            }
            const state = get();
            const copies = elements.map((element) => ({
                ...element,
                id: nextId('el'),
                x: element.x + DUPLICATE_OFFSET,
                y: element.y + DUPLICATE_OFFSET,
                seed: newSeed()
            }));
            set({ selection: copies.map((element) => element.id), ...changed(state, [...state.elements, ...copies]) });
        },
        setExportBackground(on) {
            set({ exportBackground: on });
        },
        bringToFront() {
            const state = get();
            const selected = new Set(state.selection);
            const staying = state.elements.filter((element) => !selected.has(element.id));
            const moving = state.elements.filter((element) => selected.has(element.id));
            if (moving.length === 0) {
                return;
            }
            set(changed(state, [...staying, ...moving]));
        },
        sendToBack() {
            const state = get();
            const selected = new Set(state.selection);
            const staying = state.elements.filter((element) => !selected.has(element.id));
            const moving = state.elements.filter((element) => selected.has(element.id));
            if (moving.length === 0) {
                return;
            }
            set(changed(state, [...moving, ...staying]));
        },
        toggleLockSelected() {
            const state = get();
            const selected = new Set(state.selection);
            if (selected.size === 0) {
                return;
            }
            const locking = state.elements.some((element) => selected.has(element.id) && !element.locked);
            const elements = state.elements.map((element) => (selected.has(element.id) ? { ...element, locked: locking || undefined } : element));
            // A locked element cannot be picked up again, so the selection lets go of it.
            set({ selection: locking ? [] : state.selection, ...changed(state, elements) });
        },
        unlockAll() {
            const state = get();
            if (!state.elements.some((element) => element.locked)) {
                return;
            }
            set(
                changed(
                    state,
                    state.elements.map(({ locked: _locked, ...element }) => element as DrawingElement)
                )
            );
        },

        setEditingText(id) {
            set({ editingTextId: id });
        },
        updateText(id, text) {
            const state = get();
            const element = state.elements.find((candidate) => candidate.id === id);
            if (!element || !isWritten(element) || element.text === text) {
                return;
            }
            // An empty text is nothing at all, so it takes itself off the drawing. An empty note is
            // still a sheet of paper: it stays, and waits for what is written on it later.
            const gone = text.trim() === '' && element.kind === 'text';
            const elements = gone
                ? state.elements.filter((candidate) => candidate.id !== id)
                : state.elements.map((candidate) => (candidate.id === id ? { ...candidate, text } : candidate));
            set({ selection: gone ? [] : state.selection, ...changed(state, elements) });
        },

        beginErase() {
            set({ erasing: [] });
        },
        eraseElement(id) {
            set((state) => (state.erasing.includes(id) ? {} : { erasing: [...state.erasing, id] }));
        },
        commitErase() {
            const state = get();
            const gone = new Set(state.erasing);
            if (gone.size === 0) {
                return;
            }
            const elements = state.elements.filter((element) => !gone.has(element.id) || element.locked);
            set({ erasing: [], selection: [], ...changed(state, elements) });
        },

        undo() {
            const state = get();
            const previous = state.past.at(-1);
            if (!previous) {
                return;
            }
            set({
                elements: previous,
                past: state.past.slice(0, -1),
                future: [state.elements, ...state.future],
                selection: [],
                editingTextId: null,
                draft: null,
                edits: state.edits + 1
            });
        },
        redo() {
            const state = get();
            const next = state.future[0];
            if (!next) {
                return;
            }
            set({
                elements: next,
                past: [...state.past, state.elements],
                future: state.future.slice(1),
                selection: [],
                editingTextId: null,
                draft: null,
                edits: state.edits + 1
            });
        },

        setRev(rev) {
            set({ rev });
        },
        setDirty(dirty) {
            set({ dirty });
        },
        setConflict(conflict) {
            set({ conflict });
        },
        setError(error) {
            set({ error });
        },
        applyDocument(document) {
            const state = get();
            const alive = new Set(document.elements.map((element) => element.id));
            const editing = state.editingTextId;
            set({
                loading: true,
                elements: document.elements,
                rev: document.rev,
                dirty: false,
                conflict: null,
                // The camera never moves on a reload, and what still exists stays selected.
                selection: state.selection.filter((id) => alive.has(id)),
                editingTextId: editing && alive.has(editing) ? editing : null,
                past: [],
                future: []
            });
            set({ loading: false });
        }
    }));

export const defaultDrawingStore = createDrawingStore();

/* The drawing editors of the window; its blank editor is the store this module made. */
export const defaultDrawings = createEditorRegistry(createDrawingStore, defaultDrawingStore);

export const {
    use: useDrawing,
    useStore: useDrawingStore,
    focused: focusedDrawing,
    live: liveDrawing,
    subscribe: subscribeDrawings
} = editorBindings(defaultDrawings);

/* Keeps the hand-drawn wobble of an element the same on every render and on every machine. */
export const newSeed = (): number => Math.floor(Math.random() * 2 ** 31);

/* What Escape clears, in order. False means there is nothing left and the body may be left. */
export const drawingHasSomethingToClear = (state: Pick<DrawingState, 'draft' | 'editingTextId' | 'selection' | 'tool'>): boolean =>
    state.draft !== null || state.editingTextId !== null || state.selection.length > 0 || state.tool !== 'select';
