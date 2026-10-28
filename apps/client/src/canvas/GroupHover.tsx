import { useEffect, type RefObject } from 'react';
import { hoveredGroup } from '@/canvas/group-hover';
import { useWorldPointer } from '@/canvas/use-world-pointer';
import { useCanvas, useCanvasStore } from '@/state/canvas';

/* Keeps `hoverGroupId` on the group the pointer is in, over its nodes and their handles too. Draws nothing. */
export function GroupHover({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
    const canvasStore = useCanvasStore();
    const nodes = useCanvas((s) => s.nodes);
    const order = useCanvas((s) => s.order);
    const hidden = useCanvas((s) => s.hidden);
    const point = useWorldPointer(rootRef);
    const id = hoveredGroup(nodes, order, hidden, point);

    useEffect(() => {
        canvasStore.getState().setHoverGroup(id);
    }, [canvasStore, id]);

    useEffect(() => () => canvasStore.getState().setHoverGroup(null), [canvasStore]);

    return null;
}
