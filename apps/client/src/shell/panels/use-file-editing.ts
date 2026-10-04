import { useEffect, useMemo, useState } from 'react';
import type { FsReadText } from '@ruimte/contracts';
import type { EditorEngine, EditorIndentation } from '@ruimte/smart-editor';
import { type EditBlock, editBlockOf, isCoarsePointer, useFileNodeGate } from '@/shell/panels/edit-gate';
import { DEFAULT_INDENTATION, editorConfigDirs, type EditorStyle, editorStyleFor } from '@/shell/panels/editor-config';
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
    /* The primary pointer is a finger, which the editor has no touch handling for, so the file is drawn by the viewer. */
    viewer: boolean;
    /* Null while it loads; the viewer draws the file in the meantime. */
    engine: EditorEngine | null;
    /* The defaults until the project's `.editorconfig` has been read; the editor opens at once and takes the settings when they arrive. */
    indentation: EditorIndentation;
    /* The `max_line_length` of the project's `.editorconfig`, null when it has none. */
    rightMargin: number | null;
    loadFailed: boolean;
    /* Whether the node it is in has the keyboard; null in a tab and a view. */
    focused: boolean | null;
    retryLoad(): void;
}

/* How one text file on one surface is drawn and whether it can be edited there. */
export function useFileEditing(path: string, read: FsReadText, plain: boolean, large: boolean): FileEditing {
    const endpointId = useEndpointId();
    const transport = useOptionalConnection()?.transport ?? null;
    const folder = useProject((s) => s.current?.folder ?? null);
    const worktrees = useWorktrees(transport, endpointId, folder);
    const gate = useFileNodeGate();
    const viewer = isCoarsePointer();
    const [engine, setEngine] = useState<EditorEngine | null>(loadedEditorEngine);
    const [loadFailed, setLoadFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [indent, setIndent] = useState<{ endpointId: string; path: string; value: EditorStyle } | null>(null);

    const roots = useMemo(
        () => (folder === null ? [] : [folder, ...worktrees.filter((worktree) => worktree.missing !== true).map((worktree) => worktree.path)]),
        [folder, worktrees]
    );
    const block = editBlockOf({ path, roots, large, plain, coarse: viewer });

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

    // Only a file the editor draws needs it, and a change to any `.editorconfig` on the way reads it again.
    useEffect(() => {
        if (viewer || transport === null) {
            return;
        }
        let cancelled = false;
        const read = (): void => {
            void editorStyleFor(path, roots, (target) => transport.request('fs.read', { path: target })).then((value) => {
                if (!cancelled) {
                    setIndent({ endpointId, path, value });
                }
            });
        };
        read();
        const dirs = editorConfigDirs(path, roots);
        const off = transport.on('fs.changed', (payload) => {
            if (payload.paths.some((changed) => dirs.includes(changed))) {
                read();
            }
        });
        return () => {
            cancelled = true;
            off();
        };
    }, [viewer, transport, endpointId, path, roots]);

    const style = indent?.endpointId === endpointId && indent.path === path ? indent.value : null;
    const indentation = style?.indentation ?? DEFAULT_INDENTATION;

    const retryLoad = (): void => {
        setLoadFailed(false);
        setAttempt((count) => count + 1);
    };

    return { endpointId, block, viewer, engine, indentation, rightMargin: style?.maxLineLength ?? null, loadFailed, focused: gate?.focused ?? null, retryLoad };
}
