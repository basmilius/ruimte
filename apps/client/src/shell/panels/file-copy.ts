import { desktop, type DesktopBridge } from '@/desktop/bridge';
import { basenameOf, mentionOf } from '@/shell/panels/files-tree';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';

/* A file or folder a copy menu acts on. */
export interface CopyTarget {
    /* Absolute on the daemon's machine, without a trailing slash. */
    absolute: string;
    /* What "Copy relative path" copies, relative to whatever the row is listed under; null where there is nothing to be relative to. */
    relative: string | null;
    /* Deleted from the working tree, so there is no file to copy or to mention. */
    gone?: boolean;
}

export type CopyTextKind = 'name' | 'path' | 'relative' | 'mention';

const lineOf = (folder: string | null, target: CopyTarget, kind: CopyTextKind): string | null => {
    switch (kind) {
        case 'name':
            return basenameOf(target.absolute);
        case 'path':
            return target.absolute;
        case 'relative':
            return target.relative;
        case 'mention':
            return target.gone === true ? null : mentionOf(folder, target.absolute);
    }
};

/* The text a submenu row copies: a line per target, mentions on one line the way a prompt takes them. Null when no target has one. */
export const copiedText = (folder: string | null, targets: readonly CopyTarget[], kind: CopyTextKind): string | null => {
    const lines = targets.map((target) => lineOf(folder, target, kind)).filter((line): line is string => line !== null);
    if (lines.length === 0) {
        return null;
    }
    return lines.join(kind === 'mention' ? ' ' : '\n');
};

/* What Copy puts on the clipboard as files: every target that is still there. */
export const copyableFiles = (targets: readonly CopyTarget[]): string[] => targets.filter((target) => target.gone !== true).map((target) => target.absolute);

/* The shell reaches only the disk of the computer it runs on, so a project on another machine has no file here to copy. */
export const canCopyFilesOn = (endpointId: string, bridge: DesktopBridge | null = desktop()): boolean =>
    endpointId === LOCAL_ENDPOINT_ID && typeof bridge?.copyFiles === 'function';
