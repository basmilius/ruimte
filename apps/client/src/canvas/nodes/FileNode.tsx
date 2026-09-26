import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EDIT_MIN_ZOOM, FileNodeGateContext } from '@/shell/panels/edit-gate';
import { FileSurface } from '@/shell/panels/FileSurface';
import { basenameOf } from '@/shell/panels/files-tree';
import { useCanvas } from '@/state/canvas';
import { FileIcon } from '@ruimte/ui/FileIcon';

/*
 * What a file node is while it is out of sight or too small to read: its mark and its name, with no
 * read behind it and no controls in the header. Ten file nodes would otherwise be ten reads and ten
 * editors running for frames nobody is looking at, which is the bargain a terminal already makes
 * with its own plate. An editor that goes leaves its unsaved draft behind for the next one.
 */
export function FilePlate({ id }: { id: string }) {
    const { t } = useTranslation('canvas');
    const path = useCanvas((s) => s.nodes[id]?.path ?? null);
    return (
        <div className="flex h-full w-full items-center justify-center gap-2 px-4 text-text-faint" aria-hidden="true">
            {path !== null && <FileIcon path={path} size={20} />}
            <span className="truncate text-sm">{path === null ? t('file.none') : basenameOf(path)}</span>
        </div>
    );
}

/*
 * A file on the canvas. The node holds a path and nothing else: the bytes belong to the file
 * system, and an edit belongs to the one draft of that file every surface shares
 * (`state/text-drafts.ts`), so two nodes on one file never write over each other.
 */
export function FileNode({ id, focused }: { id: string; focused: boolean }) {
    const path = useCanvas((s) => s.nodes[id]?.path ?? null);
    const zoomedOut = useCanvas((s) => s.camera.zoom < EDIT_MIN_ZOOM);
    const gate = useMemo(() => ({ zoomedOut, focused }), [zoomedOut, focused]);
    return (
        <FileNodeGateContext.Provider value={gate}>
            <FileSurface path={path} on="node" />
        </FileNodeGateContext.Provider>
    );
}
