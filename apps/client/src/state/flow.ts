import { createStore, type StoreApi } from 'zustand';
import {
    EMPTY_FLOW,
    type FlowArgValue,
    type FlowCard,
    type FlowCardKind,
    type FlowContent,
    type FlowDocument,
    type FlowLink,
    type FlowPort,
    type ProjectViewLocal
} from '@ruimte/contracts';
import { defaultArgsOf, firstEmptyArgOf, portsOf, takesInput } from '@ruimte/flow';
import { createCameraSlice, type CameraSlice } from '@/canvas/camera-slice';
import { cameraOfView, snapToGrid, type Point } from '@/canvas/math';
import { boundsOf } from '@/flow/geometry';
import { editorBindings } from '@/state/editor-bindings';
import { createEditorRegistry } from '@/state/editors';
import { nextId } from '@/state/canvas';
import { mergeSelection } from '@/state/selection';

export interface FlowState extends CameraSlice {
    /* The flow view this store holds, or null while none is on screen. */
    viewId: string | null;
    content: FlowContent;
    rev: number;
    dirty: boolean;
    /* Counts changes to the content, which is what the client saves on. */
    edits: number;
    /* What undo and redo step through: whole contents, since a worksheet is a few dozen cards. */
    past: FlowContent[];
    future: FlowContent[];
    loading: boolean;
    conflict: FlowDocument | null;
    error: string | null;
    /* The cards a person picked, to move, to fill in or to remove. */
    selection: string[];
    /* The line a person picked, which is what a key acting on the selection finds when no card is
       picked. One line at a time, and never together with a card: the two answer the same keys. */
    selectedLink: FlowLink | null;
    /* Whether trying a card out writes down what it would do rather than doing it. Per worksheet
       and never in its file: it is how a person is working right now, not part of the recipe. */
    dryTest: boolean;
    /* The field whose control is open on a card. A card is filled in where it stands, so this is
       which of its sentence a person has in hand, and putting a card down opens its first empty one. */
    editing: { cardId: string; arg: string } | null;

    load(viewId: string, document: FlowDocument, local: ProjectViewLocal | null): void;
    unload(): void;
    exportContent(): FlowContent;
    replaceContent(content: FlowContent): void;

    /* Puts a card down and picks it, and answers its id. */
    addCard(kind: FlowCardKind, card: string | undefined, at: Point): string;
    /* `first` says this is the first step of a drag, which is the one that goes into the history. */
    moveCard(id: string, at: Point, first: boolean): void;
    /* Puts another card in this one's place, keeping where it stands and the lines that still hold. */
    replaceCard(id: string, kind: FlowCardKind, card: string | undefined): void;
    /* A copy of this card beside it, with what it holds but none of its lines; answers its id. */
    duplicateCard(id: string): string | null;
    setArg(id: string, name: string, value: FlowArgValue): void;
    setInverted(id: string, inverted: boolean): void;
    removeCards(ids: readonly string[]): void;
    /* Draws a line, or moves the one that already left that port to its new end. */
    link(from: string, fromPort: FlowPort, to: string): void;
    unlink(from: string, fromPort: FlowPort, to: string): void;

    select(ids: string[], additive?: boolean): void;
    selectLink(link: FlowLink | null): void;
    /* Opens the control of one field, or closes whichever is open. */
    edit(at: { cardId: string; arg: string } | null): void;
    setDryTest(dry: boolean): void;
    undo(): void;
    redo(): void;

    setRev(rev: number): void;
    setDirty(dirty: boolean): void;
    setConflict(conflict: FlowDocument | null): void;
    setError(error: string | null): void;
    applyDocument(document: FlowDocument): void;
}

export const contentOf = (document: FlowDocument): FlowContent => ({
    ...(document.folder === undefined ? {} : { folder: document.folder }),
    cards: document.cards,
    links: document.links
});

const EMPTY_CONTENT = contentOf(EMPTY_FLOW);

export const FLOW_HISTORY_LIMIT = 100;

/* How far beside its original a copy lands, far enough that the two read as two cards. */
const DUPLICATE_OFFSET = 32;

/* The field a card that was just put down opens on, or nothing when it has nothing left to answer. */
const openingOf = (id: string, card: FlowCard): { cardId: string; arg: string } | null => {
    const arg = firstEmptyArgOf(card);
    return arg === null ? null : { cardId: id, arg };
};

const changed = (state: FlowState, content: FlowContent, first = true): Partial<FlowState> => ({
    content,
    edits: state.edits + 1,
    ...(first ? { past: [...state.past.slice(-(FLOW_HISTORY_LIMIT - 1)), state.content], future: [] } : {})
});

/* The content with one card rewritten, or null when there is no such card or nothing would change. */
const withCard = (content: FlowContent, id: string, rewrite: (card: FlowCard) => FlowCard): FlowContent | null => {
    const card = content.cards[id];
    if (card === undefined) {
        return null;
    }
    const next = rewrite(card);
    return next === card ? null : { ...content, cards: { ...content.cards, [id]: next } };
};

/*
 * The worksheet on screen: the cards, the lines and where the camera is. Everything a person does to
 * a flow goes through here, and the file behind it is the client's to save, like a drawing.
 */
export const createFlowStore = (): StoreApi<FlowState> =>
    createStore<FlowState>((set, get) => ({
        ...createCameraSlice<FlowState>(set, get, {
            boundsOfAll: (state) => boundsOf(state.content),
            boundsOfSelection: (state) => (state.selection.length === 0 ? null : boundsOf(state.content, state.selection))
        }),

        viewId: null,
        content: EMPTY_CONTENT,
        rev: 0,
        dirty: false,
        edits: 0,
        past: [],
        future: [],
        loading: false,
        conflict: null,
        error: null,
        selection: [],
        selectedLink: null,
        editing: null,
        dryTest: true,

        load(viewId, document, local) {
            set({
                loading: true,
                viewId,
                content: contentOf(document),
                rev: document.rev,
                dirty: false,
                edits: 0,
                past: [],
                future: [],
                conflict: null,
                error: null,
                selection: [],
                selectedLink: null,
                editing: null,
                pendingCamera: null
            });
            const stored = local?.camera ?? null;
            if (stored !== null) {
                const camera = cameraOfView(stored, get().viewport);
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
                content: EMPTY_CONTENT,
                rev: 0,
                dirty: false,
                edits: 0,
                past: [],
                future: [],
                conflict: null,
                error: null,
                selection: [],
                selectedLink: null,
                editing: null
            });
        },

        exportContent() {
            return get().content;
        },

        replaceContent(content) {
            set((state) => changed(state, content));
        },

        addCard(kind, card, at) {
            const state = get();
            const id = nextId('card');
            const made: FlowCard = {
                kind,
                ...(card === undefined ? {} : { card }),
                args: defaultArgsOf(kind, card),
                x: snapToGrid(at.x),
                y: snapToGrid(at.y)
            };
            set({
                ...changed(state, { ...state.content, cards: { ...state.content.cards, [id]: made } }),
                selection: [id],
                /* Putting a card down and filling it in are one move, so the first field still
                   waiting for an answer asks for it rather than sitting there quietly. */
                editing: openingOf(id, made)
            });
            return id;
        },

        moveCard(id, at, first) {
            const state = get();
            const x = Math.round(at.x);
            const y = Math.round(at.y);
            const content = withCard(state.content, id, (card) => (card.x === x && card.y === y ? card : { ...card, x, y }));
            if (content !== null) {
                set(changed(state, content, first));
            }
        },

        replaceCard(id, kind, card) {
            const state = get();
            const before = state.content.cards[id];
            if (before === undefined) {
                return;
            }
            const made: FlowCard = {
                kind,
                ...(card === undefined ? {} : { card }),
                args: defaultArgsOf(kind, card),
                x: before.x,
                y: before.y
            };
            const ports = new Set(portsOf(made));
            /* A line out of a port the new card does not offer has nowhere left to leave from, and one
               into a card that takes nothing in has nowhere to land. The rest of the drawing stands. */
            const links = state.content.links.filter((link) => (link.from !== id || ports.has(link.fromPort)) && (link.to !== id || takesInput(made)));
            set({ ...changed(state, { ...state.content, cards: { ...state.content.cards, [id]: made }, links }), editing: openingOf(id, made) });
        },

        duplicateCard(id) {
            const state = get();
            const before = state.content.cards[id];
            if (before === undefined) {
                return null;
            }
            const made = nextId('card');
            /* Beside the original rather than on top of it, and none of its lines: a copy is a
               second card to draw into, not a second card in the same place in the graph. */
            const copy: FlowCard = { ...before, args: { ...before.args }, x: snapToGrid(before.x + DUPLICATE_OFFSET), y: before.y };
            set({ ...changed(state, { ...state.content, cards: { ...state.content.cards, [made]: copy } }), selection: [made], editing: null });
            return made;
        },

        setArg(id, name, value) {
            const state = get();
            const content = withCard(state.content, id, (card) => (card.args[name] === value ? card : { ...card, args: { ...card.args, [name]: value } }));
            if (content !== null) {
                set(changed(state, content));
            }
        },

        setInverted(id, inverted) {
            const state = get();
            const content = withCard(state.content, id, (card) => {
                if ((card.inverted === true) === inverted) {
                    return card;
                }
                if (!inverted) {
                    const { inverted: _was, ...rest } = card;
                    return rest;
                }
                return { ...card, inverted: true };
            });
            if (content !== null) {
                set(changed(state, content));
            }
        },

        removeCards(ids) {
            const state = get();
            const gone = new Set(ids);
            if (gone.size === 0) {
                return;
            }
            const cards = Object.fromEntries(Object.entries(state.content.cards).filter(([id]) => !gone.has(id)));
            // A line without both its ends is not a line, so a card that goes takes them with it.
            const links = state.content.links.filter((link) => !gone.has(link.from) && !gone.has(link.to));
            set({
                ...changed(state, { ...state.content, cards, links }),
                selection: state.selection.filter((id) => !gone.has(id)),
                selectedLink: null,
                ...(state.editing !== null && gone.has(state.editing.cardId) ? { editing: null } : {})
            });
        },

        link(from, fromPort, to) {
            const state = get();
            const source = state.content.cards[from];
            const target = state.content.cards[to];
            if (source === undefined || target === undefined || from === to || !portsOf(source).includes(fromPort)) {
                return;
            }
            if (state.content.links.some((link) => link.from === from && link.fromPort === fromPort && link.to === to)) {
                return;
            }
            set(changed(state, { ...state.content, links: [...state.content.links, { from, fromPort, to }] }));
        },

        unlink(from, fromPort, to) {
            const state = get();
            const links = state.content.links.filter((link) => !(link.from === from && link.fromPort === fromPort && link.to === to));
            if (links.length !== state.content.links.length) {
                set({ ...changed(state, { ...state.content, links }), selectedLink: null });
            }
        },

        select(ids, additive = false) {
            set((state) => ({ selection: mergeSelection(state.selection, ids, additive ? 'toggle' : 'replace'), selectedLink: null }));
        },

        selectLink(link) {
            set({ selectedLink: link, selection: [], editing: null });
        },

        edit(at) {
            set({ editing: at });
        },

        setDryTest(dry) {
            set({ dryTest: dry });
        },

        undo() {
            const state = get();
            const previous = state.past.at(-1);
            if (!previous) {
                return;
            }
            set({ content: previous, past: state.past.slice(0, -1), future: [state.content, ...state.future], edits: state.edits + 1, selectedLink: null });
        },

        redo() {
            const state = get();
            const next = state.future[0];
            if (!next) {
                return;
            }
            set({ content: next, past: [...state.past, state.content], future: state.future.slice(1), edits: state.edits + 1, selectedLink: null });
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
            // What is on disk now is another starting point, so the steps back from the old one are gone.
            set({ loading: true, content: contentOf(document), rev: document.rev, dirty: false, conflict: null, past: [], future: [], selectedLink: null });
            set({ loading: false });
        }
    }));

export const defaultFlowStore = createFlowStore();

/* The flow editors of the window; its blank editor is the store this module made. */
export const defaultFlows = createEditorRegistry(createFlowStore, defaultFlowStore);

export const { use: useFlow, useStore: useFlowStore, focused: focusedFlow, live: liveFlow, subscribe: subscribeFlows } = editorBindings(defaultFlows);
