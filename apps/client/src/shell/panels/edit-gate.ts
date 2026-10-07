import { createContext, useContext } from 'react';
import { isUnderFolder } from '@/state/fs-watch';

/* Why a file is read only here. Binary files, files too large to read and diffs never reach an editor at all. */
export type EditBlock = 'outside-project' | 'ruimte-state' | 'large' | 'plain' | 'touch';

export interface EditGateInput {
    /* Absolute on the daemon's machine. */
    path: string;
    /* The open project's folder and the worktrees of its repository, where the machine takes a save from this client. */
    roots: readonly string[];
    /* Past `FS_READ_MAX_TEXT_BYTES`, which a save cannot carry. */
    large: boolean;
    /* The file is drawn as plain text for its length. */
    plain: boolean;
    /* The primary pointer is a finger, which the editor has no touch handling for. */
    coarse: boolean;
}

function isInside(root: string, path: string): boolean {
    return path === root || isUnderFolder(path, root);
}

/*
 * The machine's rule for `fs.write`, mirrored so a person never types an edit it will refuse.
 * The machine stays the authority: a worktree outside its own worktrees folder is offered here and
 * refused there, which the save says.
 */
export function editBlockOf({ path, roots, large, plain, coarse }: EditGateInput): EditBlock | null {
    const inside = roots.filter((root) => isInside(root, path));
    if (inside.length === 0) {
        return 'outside-project';
    }
    // A person's database consoles are files like any other, the one place in `.ruimte` the machine writes from here.
    if (inside.some((root) => isInside(`${root}/.ruimte`, path) && !isUnderFolder(path, `${root}/.ruimte/private/consoles`))) {
        return 'ruimte-state';
    }
    if (large) {
        return 'large';
    }
    if (plain) {
        return 'plain';
    }
    return coarse ? 'touch' : null;
}

export function isCoarsePointer(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

export interface FileNodeGate {
    /* The node holds the canvas's `bodyFocusId` in the focused cell, so its editor may have the keyboard. */
    focused: boolean;
}

/* What a file node tells the editor in it. A tab and a view have none. */
export const FileNodeGateContext = createContext<FileNodeGate | null>(null);

export function useFileNodeGate(): FileNodeGate | null {
    return useContext(FileNodeGateContext);
}
