import { useShallow } from 'zustand/react/shallow';
import { useCanvas } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { nodeStatus, useSessions } from '@/state/sessions';
import { StatusDot } from '@/canvas/NodeFrame';
import { Separator } from '@/ui/Separator';
import { Tooltip } from '@/ui/Tooltip';

/* How many nodes need you and how many are working; the first is a button that walks through them. */
export function StatusSummary() {
    const nodes = useCanvas(useShallow((s) => s.order.map((id) => s.nodes[id])));
    const selection = useCanvas((s) => s.selection);
    const sessions = useSessions((s) => s.byNodeId);
    const chats = useChats((s) => s.byNodeId);

    const needsYou = nodes.filter((n) => nodeStatus(n, sessions, chats) === 'needs-you');
    const running = nodes.filter((n) => nodeStatus(n, sessions, chats) === 'running').length;
    if (needsYou.length === 0 && running === 0) {
        return null;
    }

    const next = (): void => {
        // Starts after the selected node, so repeated clicks visit every node that waits.
        const at = needsYou.findIndex((n) => selection.includes(n.id));
        const target = needsYou[(at + 1) % needsYou.length];
        if (target) {
            useCanvas.getState().goToNode(target.id);
        }
    };

    return (
        <>
            <div className="flex items-center gap-1">
                {needsYou.length > 0 && (
                    <Tooltip label="Go to the next node that needs you" name>
                        <button
                            className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs tabular-nums text-text-muted hover:bg-surface-sunken hover:text-text"
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
