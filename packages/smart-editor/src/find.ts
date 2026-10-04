import type { DocumentChange, DocumentModel } from '@ruimte/smart-editor-core';
import { mapOffset } from './offsets.ts';
import type { EditorFindQuery, EditorFindState } from './types.ts';

export interface FindMark {
    from: number;
    to: number;
}

/* Past this a count means nothing to a reader, and marking every match would stall the editor. */
export const FIND_LIMIT = 10000;

/*
 * The find of the host's find bar: every match marked, one of them current. It searches the model on
 * its own and never touches the selection until the find ends.
 */
export class FindController {
    private query: EditorFindQuery | null = null;
    private marks: FindMark[] = [];
    private index: number | null = null;
    /* The text a search in the selection is held to, which follows the text through edits; null when nothing was selected. */
    private bounds: { from: number; to: number } | null = null;
    /* Where the next refresh looks for the current match from, once: right after what a replace wrote. */
    pendingAnchor: number | undefined;

    private readonly model: DocumentModel;

    constructor(model: DocumentModel) {
        this.model = model;
    }

    get activeQuery(): EditorFindQuery | null {
        return this.query;
    }

    get active(): boolean {
        return this.query !== null;
    }

    get matches(): readonly FindMark[] {
        return this.marks;
    }

    get current(): number | null {
        return this.index;
    }

    get state(): EditorFindState {
        return { count: this.marks.length, current: this.index, ...(this.query?.inSelection === true && this.bounds === null ? { noSelection: true } : {}) };
    }

    /* The range a search in the selection is held to. */
    get scope(): { from: number; to: number } | null {
        return this.query?.inSelection === true ? this.bounds : null;
    }

    get currentMark(): FindMark | null {
        return this.index === null ? null : (this.marks[this.index] ?? null);
    }

    /* A new query, or null to end the find. */
    set(query: EditorFindQuery | null): void {
        const wasInSelection = this.query?.inSelection === true;
        this.query = query === null || query.text === '' ? null : query;
        if (this.query?.inSelection !== true) {
            this.bounds = null;
        } else if (!wasInSelection) {
            const selection = this.model.getPrimary();
            this.bounds =
                selection.anchor === selection.head
                    ? null
                    : { from: Math.min(selection.anchor, selection.head), to: Math.max(selection.anchor, selection.head) };
        }
        this.refresh();
    }

    /* The text of a search in the selection moved with an edit. */
    mapBounds(changes: readonly DocumentChange[]): void {
        if (this.bounds !== null) {
            this.bounds = { from: mapOffset(this.bounds.from, changes), to: mapOffset(this.bounds.to, changes) };
        }
    }

    /*
     * The matches again, after a new query or an edit. The current one is the first from where the
     * previous one was, or from the cursor, so each letter typed keeps the place instead of starting over.
     */
    refresh(): void {
        const previous = this.currentMark;
        const query = this.query;
        if (query === null) {
            this.marks = [];
            this.index = null;
            return;
        }
        let found: FindMark[] = [];
        try {
            const inSelection = query.inSelection === true;
            if (!inSelection || this.bounds !== null) {
                found = this.model
                    .find(query.text, {
                        caseSensitive: query.caseSensitive,
                        wholeWord: query.wholeWord,
                        regex: query.regex,
                        maxResults: FIND_LIMIT,
                        ...(inSelection ? this.bounds : {})
                    })
                    .map((match) => ({ from: match.from, to: match.to }));
            }
        } catch {
            // A pattern that does not parse finds nothing; the find bar says it is invalid.
        }
        this.marks = found;
        const selection = this.model.getPrimary();
        const anchor = this.pendingAnchor ?? previous?.from ?? Math.min(selection.anchor, selection.head);
        this.pendingAnchor = undefined;
        const next = found.findIndex((mark) => mark.from >= anchor);
        this.index = found.length === 0 ? null : Math.max(0, next);
    }

    step(direction: 1 | -1): void {
        const count = this.marks.length;
        if (count === 0) {
            return;
        }
        this.index = this.index === null ? (direction === 1 ? 0 : count - 1) : (this.index + direction + count) % count;
    }
}
