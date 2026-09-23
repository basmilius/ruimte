import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FsReadText } from '@ruimte/contracts';
import type { EditorEngine } from '@ruimte/editor';
import { type EditBlock, editBlockOf, isCoarsePointer, useFileNodeGate } from '@/shell/panels/edit-gate';
import { loadEditorEngine } from '@/shell/panels/editor-engine';
import type { EditStart } from '@/shell/panels/FileEditor';
import { useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { textDrafts, useUnsaved } from '@/state/text-drafts';
import { useWorktrees } from '@/state/worktrees';
import { useOptionalConnection } from '@/transport/context';

export interface FileEditing {
    endpointId: string;
    /* Why the file is not offered for editing here, null when it is. */
    block: EditBlock | null;
    /* An editor is up or on its way: a person asked for one, or the file has unsaved changes. */
    wanted: boolean;
    /* Loaded once an editor is wanted; the viewer stays until then. */
    engine: EditorEngine | null;
    loadFailed: boolean;
    start: EditStart | null;
    /* A node zoomed out keeps its editor, read only, so a draft never goes away by zooming. */
    readOnly: boolean;
    /* Whether the node it is in has the keyboard; null in a tab and a view. */
    focused: boolean | null;
    begin(start: EditStart): void;
    /* Back to reading once what was typed is saved. */
    stop(): void;
    retryLoad(): void;
}

/* Whether and how one text file on one surface is being edited. */
export const useFileEditing = (path: string, read: FsReadText, plain: boolean): FileEditing => {
    const endpointId = useEndpointId();
    const transport = useOptionalConnection()?.transport ?? null;
    const folder = useProject((s) => s.current?.folder ?? null);
    const worktrees = useWorktrees(transport, endpointId, folder);
    const gate = useFileNodeGate();
    const unsaved = useUnsaved(endpointId, path);
    // Null start: the editor came up for a draft this surface did not type, and it stays up once it did.
    const [asked, setAsked] = useState<{ start: EditStart | null } | null>(null);
    const [engine, setEngine] = useState<EditorEngine | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);

    const roots = useMemo(
        () => (folder === null ? [] : [folder, ...worktrees.filter((worktree) => worktree.missing !== true).map((worktree) => worktree.path)]),
        [folder, worktrees]
    );
    const block = editBlockOf({ path, roots, plain, coarse: isCoarsePointer(), zoomedOut: gate?.zoomedOut ?? false });
    const offered = block === null || block === 'zoom';
    // Derived while rendering, the way `culling.ts` re-arms its hold: an effect would draw the viewer once more first.
    if (offered && unsaved && asked === null) {
        setAsked({ start: null });
    }
    const wanted = offered && asked !== null;

    useEffect(() => textDrafts.hold(endpointId, path), [endpointId, path]);

    useEffect(() => {
        textDrafts.received(endpointId, path, { text: read.text, mtime: read.mtime });
    }, [endpointId, path, read]);

    useEffect(() => {
        if (!wanted || engine !== null) {
            return;
        }
        let cancelled = false;
        loadEditorEngine()
            .then((loaded) => {
                if (!cancelled) {
                    setEngine(loaded);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setLoadFailed(true);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [wanted, engine, attempt]);

    const begin = useCallback(
        (start: EditStart) => {
            if (block === null) {
                setAsked({ start });
            }
        },
        [block]
    );

    const stop = useCallback(() => {
        void textDrafts.save(endpointId, path).then(() => setAsked(null));
    }, [endpointId, path]);

    const retryLoad = useCallback(() => {
        setLoadFailed(false);
        setAttempt((count) => count + 1);
    }, []);

    return {
        endpointId,
        block,
        wanted,
        engine,
        loadFailed,
        start: asked?.start ?? null,
        readOnly: block === 'zoom',
        focused: gate?.focused ?? null,
        begin,
        stop,
        retryLoad
    };
};
