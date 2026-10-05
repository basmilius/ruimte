import type { Editor } from '@ruimte/smart-editor';
import { endpointKey } from '@/state/keys';
import { type TextDrafts, textDrafts, useTextDrafts } from '@/state/text-drafts';
import type { Transport } from '@/transport/transport';
import { ConflictResolution } from './conflict-resolution';

export interface ConflictFile {
    endpointId: string;
    projectId: string;
    /* Absolute on the machine. */
    path: string;
}

/* The review under way in an editor, by file, so a bar that is not part of the editor can bring it up. */
const reviews = new Map<string, ConflictResolution>();

/* Brings up the rows of the file's review in the editor that has it open; false when no editor does, and the caller opens the file. */
export function reviewConflict(endpointId: string, path: string): boolean {
    const review = reviews.get(endpointKey(endpointId, path));
    if (review === undefined) {
        return false;
    }
    review.review();
    return true;
}

/*
 * A `ConflictResolution` for the file of an editor, on the shared draft: it starts when the draft has
 * an incoming text and ends when it has none. The runs that name who wrote the other side are asked
 * for however agent changes are set, since a row that says who wrote the lines is not a mark in the gutter.
 */
export function mountConflictResolution(
    editor: Editor,
    transport: Pick<Transport, 'request' | 'on'>,
    file: ConflictFile,
    options: { drafts?: TextDrafts } = {}
): { conflict: ConflictResolution; unmount(): void } {
    const drafts = options.drafts ?? textDrafts;
    const key = endpointKey(file.endpointId, file.path);
    const conflict = new ConflictResolution(
        editor,
        {
            versions: () => {
                const draft = useTextDrafts.getState().rows[key];
                return draft?.incoming === undefined ? null : { disk: draft.disk, incoming: draft.incoming };
            },
            onDraft: (listener) =>
                useTextDrafts.subscribe((state, previous) => {
                    if (state.rows[key] !== previous.rows[key]) {
                        listener();
                    }
                }),
            resolve: (merged) => drafts.resolveIncoming(file.endpointId, file.path, merged),
            runs: () => transport.request('provenance.read', { projectId: file.projectId, path: file.path })
        },
        key
    );
    const stopEvents = transport.on('provenance.changed', (event) => {
        if (event.projectId === file.projectId && event.path === file.path) {
            void conflict.refreshAuthors();
        }
    });
    reviews.set(key, conflict);
    return {
        conflict,
        unmount: () => {
            stopEvents();
            if (reviews.get(key) === conflict) {
                reviews.delete(key);
            }
            conflict.dispose();
        }
    };
}
