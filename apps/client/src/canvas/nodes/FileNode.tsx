import { useTranslation } from 'react-i18next';
import { FileSurface } from '@/shell/panels/FileSurface';
import { basenameOf } from '@/shell/panels/files-tree';
import { useCanvas } from '@/state/canvas';
import { FileIcon } from '@/ui/FileIcon';

/*
 * What a file node is while it is out of sight or too small to read: its mark and its name, with no
 * read behind it and no controls in the header. Ten file nodes would otherwise be ten reads and ten
 * renderers running for frames nobody is looking at, which is the bargain a terminal already makes
 * with its own plate.
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
 * system, so two nodes on one file are two independent readers with nothing between them.
 */
export function FileNode({ id }: { id: string }) {
    const path = useCanvas((s) => s.nodes[id]?.path ?? null);
    return <FileSurface path={path} on="node" />;
}
