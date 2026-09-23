import { useEffect, useMemo, useState } from 'react';
import type { FsReadText } from '@ruimte/contracts';
import type { EditorEngine } from '@ruimte/editor';
import { type EditBlock, editBlockOf, isCoarsePointer, useFileNodeGate } from '@/shell/panels/edit-gate';
import { loadEditorEngine, loadedEditorEngine } from '@/shell/panels/editor-engine';
import { useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { textDrafts } from '@/state/text-drafts';
import { useWorktrees } from '@/state/worktrees';
import { useOptionalConnection } from '@/transport/context';

export interface FileEditing {
    endpointId: string;
    /* Why the file is read only here, null when it can be edited. */
    block: EditBlock | null;
    /* The primary pointer is a finger, which Monaco does not take, so the file is drawn by the viewer. */
    viewer: boolean;
    /* Null while it loads; the viewer draws the file in the meantime. */
    engine: EditorEngine | null;
    loadFailed: boolean;
    /* Whether the node it is in has the keyboard; null in a tab and a view. */
    focused: boolean | null;
    retryLoad(): void;
}

/* How one text file on one surface is drawn and whether it can be edited there. */
export const useFileEditing = (path: string, read: FsReadText, plain: boolean): FileEditing => {
    const endpointId = useEndpointId();
    const transport = useOptionalConnection()?.transport ?? null;
    const folder = useProject((s) => s.current?.folder ?? null);
    const worktrees = useWorktrees(transport, endpointId, folder);
    const gate = useFileNodeGate();
    const viewer = isCoarsePointer();
    const [engine, setEngine] = useState<EditorEngine | null>(loadedEditorEngine);
    const [loadFailed, setLoadFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);

    const roots = useMemo(
        () => (folder === null ? [] : [folder, ...worktrees.filter((worktree) => worktree.missing !== true).map((worktree) => worktree.path)]),
        [folder, worktrees]
    );
    const block = editBlockOf({ path, roots, plain, coarse: viewer, zoomedOut: gate?.zoomedOut ?? false });

    useEffect(() => textDrafts.hold(endpointId, path), [endpointId, path]);

    useEffect(() => {
        textDrafts.received(endpointId, path, { text: read.text, mtime: read.mtime });
    }, [endpointId, path, read]);

    useEffect(() => {
        if (viewer || engine !== null) {
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
    }, [viewer, engine, attempt]);

    const retryLoad = (): void => {
        setLoadFailed(false);
        setAttempt((count) => count + 1);
    };

    return { endpointId, block, viewer, engine, loadFailed, focused: gate?.focused ?? null, retryLoad };
};
