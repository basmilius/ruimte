import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { projectNodes, revealNode } from '@/project/views';
import { useCanvas } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { useEndpointId } from '@/state/keys';
import { useDocument } from '@/state/document';
import { nodeStatus, useSessions } from '@/state/sessions';
import { StatusDot } from '@/canvas/NodeFrame';
import { Separator } from '@/ui/Separator';
import { Tooltip } from '@/ui/Tooltip';

/* How many nodes need you and how many are working, over the whole project; the first is a button
   that walks through them, across views. */
export function StatusSummary() {
    const views = useDocument((s) => s.views);
    const activeViewId = useDocument((s) => s.activeViewId);
    const order = useCanvas(useShallow((s) => s.order));
    const canvasNodes = useCanvas((s) => s.nodes);
    const selection = useCanvas((s) => s.selection);
    const endpointId = useEndpointId();
    const sessions = useSessions((s) => s.byKey);
    const chats = useChats((s) => s.byKey);

    // The dependencies are what `projectNodes` reads; the call itself takes the stores as they are.
    const nodes = useMemo(() => projectNodes(), [views, activeViewId, order, canvasNodes]);

    const needsYou = nodes.filter((node) => nodeStatus(node, sessions, chats, endpointId) === 'needs-you');
    const running = nodes.filter((node) => nodeStatus(node, sessions, chats, endpointId) === 'running').length;
    if (needsYou.length === 0 && running === 0) {
        return null;
    }

    const next = (): void => {
        // Starts after the selected node, so repeated clicks visit every node that waits.
        const at = needsYou.findIndex((node) => selection.includes(node.id));
        const target = needsYou[(at + 1) % needsYou.length];
        if (target) {
            revealNode(target.id);
        }
    };

    return (
        <>
            <div className="flex items-center gap-1">
                {needsYou.length > 0 && (
                    <Tooltip label="Go to the next node that needs you, in any view" name>
                        <button
                            className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs tabular-nums text-text-muted hover:bg-surface-hover hover:text-text"
                            onClick={next}
                        >
                            <StatusDot status="needs-you" plain />
                            {needsYou.length}
                        </button>
                    </Tooltip>
                )}
                {running > 0 && (
                    <Tooltip label="Agents working">
                        <span
                            role="status"
                            aria-label={`${running} agents working`}
                            className="flex h-8 items-center gap-1.5 px-2 text-xs tabular-nums text-text-muted"
                        >
                            <StatusDot status="running" plain />
                            {running}
                        </span>
                    </Tooltip>
                )}
            </div>
            <Separator />
        </>
    );
}
