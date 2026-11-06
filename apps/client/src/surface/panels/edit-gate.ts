import { isRuimteState, relativeTo } from '@ruimte/contracts';
import { createContext, useContext } from 'react';
import { isUnderFolder } from '@/paths/file-path';

/* Why a file is read only here. Binary files, files too large to read and diffs never reach an editor at all. */
export type EditBlock = 'outside-project' | 'ruimte-state' | 'large' | 'plain' | 'long-lines' | 'touch';

export interface EditGateInput {
    /* Absolute on the daemon's machine. */
    path: string;
    /* The open project's folder and the worktrees of its repository, where the machine takes a save from this client. */
    roots: readonly string[];
    /* Past what the editor takes or a save to this machine carries. */
    large: boolean;
    /* The file is past the lines the editor takes. */
    plain: boolean;
    /* The lines are so long on average, as in a minified file, that the editor would stall on them. */
    longLines?: boolean;
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
export function editBlockOf({ path, roots, large, plain, longLines = false, coarse }: EditGateInput): EditBlock | null {
    const inside = roots.filter((root) => isInside(root, path));
    if (inside.length === 0) {
        return 'outside-project';
    }
    if (inside.some((root) => isRuimteState(relativeTo(root, path).split('/')))) {
        return 'ruimte-state';
    }
    if (large) {
        return 'large';
    }
    if (plain) {
        return 'plain';
    }
    if (longLines) {
        return 'long-lines';
    }
    return coarse ? 'touch' : null;
}

export function isCoarsePointer(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

interface FileNodeGate {
    /* The node holds the canvas's `bodyFocusId` in the focused cell, so its editor may have the keyboard. */
    focused: boolean;
}

/* What a file node tells the editor in it. A tab and a view have none. */
export const FileNodeGateContext = createContext<FileNodeGate | null>(null);

export function useFileNodeGate(): FileNodeGate | null {
    return useContext(FileNodeGateContext);
}
