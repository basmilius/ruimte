import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { CircleCheck } from 'lucide-react';
import { projectNodes, revealNode } from '@/project/views';
import { groupAttention, useAttention } from '@/state/attention';
import { useCanvas } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { useEndpointId } from '@/state/keys';
import { useDocument } from '@/state/document';
import { useSessions } from '@/state/sessions';
import { useSnoozes } from '@/state/snooze';
import { StatusDot } from '@/canvas/NodeFrame';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';
import { Tooltip } from '@/ui/Tooltip';

/* A count that walks through the nodes behind it, across views, one per click. */
function Walker({ label, count, ids, children }: { label: string; count: number; ids: string[]; children: ReactNode }) {
    const selection = useCanvas((s) => s.selection);
    const next = (): void => {
        // Starts after the selected node, so repeated clicks visit every node in the list.
        const at = ids.findIndex((id) => selection.includes(id));
        const target = ids[(at + 1) % ids.length];
        if (target) {
            revealNode(target);
        }
    };
    return (
        <Tooltip label={label} name>
            <button
                className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs tabular-nums text-text-muted hover:bg-surface-hover hover:text-text"
                onClick={next}
            >
                {children}
                {count}
            </button>
        </Tooltip>
    );
}

/*
 * What the project still wants from a person: how many nodes are waiting on you, how many agents are
 * working, and how many finished while you were not looking. Every one of them is counted in
 * `state/attention.ts`, which is also what the dock badge and the shell's quit guard read.
 */
export function StatusSummary() {
    const { t } = useTranslation('shell');
    const views = useDocument((s) => s.views);
    const activeViewId = useDocument((s) => s.activeViewId);
    const order = useCanvas(useShallow((s) => s.order));
    const canvasNodes = useCanvas((s) => s.nodes);
    const endpointId = useEndpointId();
    const sessions = useSessions((s) => s.byKey);
    const chats = useChats((s) => s.statusByKey);
    const unseen = useAttention((s) => s.unseen);
    const snoozes = useSnoozes((s) => s.byKey);

    // The dependencies are what `projectNodes` reads; the call itself takes the stores as they are.
    const nodes = useMemo(() => projectNodes(), [views, activeViewId, order, canvasNodes]);

    const groups = groupAttention(nodes, sessions, chats, endpointId, unseen, snoozes);
    if (groups.needsYou.length === 0 && groups.working.length === 0 && groups.finished.length === 0) {
        return null;
    }

    return (
        <>
            <div className="flex items-center gap-1">
                {groups.needsYou.length > 0 && (
                    <Walker label={t('status.nextNeedsYou')} count={groups.needsYou.length} ids={groups.needsYou}>
                        <StatusDot status="needs-you" plain />
                    </Walker>
                )}
                {groups.working.length > 0 && (
                    <Tooltip label={t('status.working')}>
                        <span
                            role="status"
                            aria-label={t('status.workingCount', { count: groups.working.length })}
                            className="flex h-8 items-center gap-1.5 px-2 text-xs tabular-nums text-text-muted"
                        >
                            <StatusDot status="running" plain />
                            {groups.working.length}
                        </span>
                    </Tooltip>
                )}
                {groups.finished.length > 0 && (
                    <Walker label={t('status.nextFinished')} count={groups.finished.length} ids={groups.finished}>
                        <Icon icon={CircleCheck} size={12} className="text-status-idle" />
                    </Walker>
                )}
            </div>
            <Separator />
        </>
    );
}
