import { processFile, type FileDiffMetadata } from '@pierre/diffs';

/* The two whole texts a patch was made between. */
export interface DiffContents {
    readonly old: string;
    readonly new: string;
}

/*
 * A patch laid over the two whole texts it was made between, which is what lets a reader unfold
 * the lines between its hunks. The hunks stay the patch's own, so a patch made without whitespace
 * keeps its counts. Null when there is no hunk to lay over them, and the patch alone is drawn.
 */
export const fullFileDiff = (patch: string, name: string, contents: DiffContents): FileDiffMetadata | null => {
    try {
        const parsed = processFile(patch, {
            oldFile: { name, contents: contents.old },
            newFile: { name, contents: contents.new },
            throwOnError: true
        });
        return parsed === undefined || parsed.isPartial || parsed.hunks.length === 0 ? null : parsed;
    } catch {
        return null;
    }
};
