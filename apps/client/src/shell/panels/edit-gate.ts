import { createContext, useContext } from 'react';
import { isUnderFolder } from '@/state/fs-watch';

/*
 * The canvas zoom a file node can be edited from. Monaco measures a click against its own layout and
 * not the scale an ancestor puts on it, so under a transform the offset grows until the cursor lands
 * on a neighboring line: microsoft/monaco-editor#4468. Below this a node's editor is read only.
 * Remove it once that issue is fixed upstream.
 */
export const EDIT_MIN_ZOOM = 0.6;

/* Why a file is read only here. Binary files, files too large to read and diffs never reach an editor at all. */
export type EditBlock = 'outside-project' | 'ruimte-state' | 'large' | 'plain' | 'touch' | 'zoom';

export interface EditGateInput {
    /* Absolute on the daemon's machine. */
    path: string;
    /* The open project's folder and the worktrees of its repository, where the machine takes a save from this client. */
    roots: readonly string[];
    /* Past `FS_READ_MAX_TEXT_BYTES`, which a save cannot carry. */
    large: boolean;
    /* The file is drawn as plain text for its length. */
    plain: boolean;
    /* The primary pointer is a finger, which Monaco does not take. */
    coarse: boolean;
    /* A node below `EDIT_MIN_ZOOM`; a tab and a view are never scaled. */
    zoomedOut: boolean;
}

function isInside(root: string, path: string): boolean {
    return path === root || isUnderFolder(path, root);
}

/*
 * The machine's rule for `fs.write`, mirrored so a person never types an edit it will refuse.
 * The machine stays the authority: a worktree outside its own worktrees folder is offered here and
 * refused there, which the save says.
 */
export function editBlockOf({ path, roots, large, plain, coarse, zoomedOut }: EditGateInput): EditBlock | null {
    const inside = roots.filter((root) => isInside(root, path));
    if (inside.length === 0) {
        return 'outside-project';
    }
    if (inside.some((root) => isInside(`${root}/.ruimte`, path))) {
        return 'ruimte-state';
    }
    if (large) {
        return 'large';
    }
    if (plain) {
        return 'plain';
    }
    if (coarse) {
        return 'touch';
    }
    return zoomedOut ? 'zoom' : null;
}

export function isCoarsePointer(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

export interface FileNodeGate {
    zoomedOut: boolean;
    /* The node holds the canvas's `bodyFocusId` in the focused cell, so its editor may have the keyboard. */
    focused: boolean;
}

/* What a file node tells the editor in it. A tab and a view have none. */
export const FileNodeGateContext = createContext<FileNodeGate | null>(null);

export function useFileNodeGate(): FileNodeGate | null {
    return useContext(FileNodeGateContext);
}
