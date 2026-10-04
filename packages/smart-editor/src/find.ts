import type { DocumentModel } from '@ruimte/smart-editor-core';
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
        return { count: this.marks.length, current: this.index };
    }

    get currentMark(): FindMark | null {
        return this.index === null ? null : (this.marks[this.index] ?? null);
    }

    /* A new query, or null to end the find. */
    set(query: EditorFindQuery | null): void {
        this.query = query === null || query.text === '' ? null : query;
        this.refresh();
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
            found = this.model
                .find(query.text, { caseSensitive: query.caseSensitive, wholeWord: query.wholeWord, regex: query.regex, maxResults: FIND_LIMIT })
                .map((match) => ({ from: match.from, to: match.to }));
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
