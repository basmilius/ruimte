import { FileSurface } from '@/shell/panels/FileSurface';
import { useCanvas } from '@/state/canvas';

/*
 * A file on the canvas. The node holds a path and nothing else: the bytes belong to the file
 * system, so two nodes on one file are two independent readers with nothing between them.
 */
export function FileNode({ id }: { id: string }) {
    const path = useCanvas((s) => s.nodes[id]?.path ?? null);
    return <FileSurface path={path} on="node" />;
}
