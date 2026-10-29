import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleCheck } from 'lucide-react';
import { useProjectNodes, type ProjectNodeRef } from '@/project/view-nodes';
import { revealNode } from '@/project/views';
import { groupAttention, useAttention } from '@/state/attention';
import { shownChatOfNode } from '@/design/design-chat';
import { useCanvasStore } from '@/state/canvas';
import { useChats } from '@adecore/agents-react/state';
import { useEndpointId } from '@/state/keys';
import { nodeWaitAsk, useSessions } from '@/state/sessions';
import { useSnoozes } from '@/state/snooze';
import { oldestWaitingFirst, useWaitingSince } from '@/state/waiting';
import { waitAskLine } from './wait-ask';
import { StatusDot } from '@/canvas/NodeFrame';
import { Button, Icon, Separator, Tooltip } from '@adecore/ui';

/* A count that walks through the nodes behind it, across views, one per click. */
function Walker({ label, detail, count, ids, children }: { label: string; detail?: ReactNode; count: number; ids: string[]; children: ReactNode }) {
    const canvasStore = useCanvasStore();
    const next = (): void => {
        // Starts after the selected node, so repeated clicks visit every node in the list. A design is
        // selected as its node and counted as the chat it shows.
        const { selection, nodes } = canvasStore.getState();
        const selected = selection.map((id) => (nodes[id] === undefined ? id : (shownChatOfNode(nodes[id]) ?? id)));
        const at = ids.findIndex((id) => selected.includes(id));
        const target = ids[(at + 1) % ids.length];
        if (target) {
            revealNode(target);
        }
    };
    return (
        <Tooltip
            label={
                <>
                    {label}
                    {detail}
                </>
            }
        >
            <Button className="tabular-nums" aria-label={label} onClick={next}>
                {children}
                {count}
            </Button>
        </Tooltip>
    );
}

const WAITING_LINES = 3;

/* What the nodes that wait ask, the one that waited longest first. */
function WaitingLines({ nodes, ids }: { nodes: readonly ProjectNodeRef[]; ids: readonly string[] }) {
    const { t } = useTranslation('shell');
    const endpointId = useEndpointId();
    const sessions = useSessions((s) => s.byKey);
    const chats = useChats((s) => s.statusByKey);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const lines = ids.slice(0, WAITING_LINES).flatMap((id) => {
        const node = byId.get(id);
        if (!node) {
            return [];
        }

        const ask = nodeWaitAsk(node, sessions, chats, endpointId);

        return [{ id, line: t('status.waitingLine', { title: node.title, ask: ask ? waitAskLine(ask) : t('notifications.needsYou') }) }];
    });
    const rest = ids.length - lines.length;

    return (
        <>
            {lines.map(({ id, line }) => (
                <span key={id} className="block truncate text-text-muted">
                    {line}
                </span>
            ))}
            {rest > 0 && <span className="block text-text-muted">{t('status.moreWaiting', { count: rest })}</span>}
        </>
    );
}

/*
 * What the project still wants from a person: how many nodes are waiting on you, how many agents are
 * working, and how many finished while you were not looking. Every one of them is counted in
 * `state/attention.ts`, which is also what the dock badge and the shell's quit guard read.
 */
export function StatusSummary() {
    const { t } = useTranslation('shell');
    const endpointId = useEndpointId();
    const sessions = useSessions((s) => s.byKey);
    const chats = useChats((s) => s.statusByKey);
    const unseen = useAttention((s) => s.unseen);
    const snoozes = useSnoozes((s) => s.byKey);
    const since = useWaitingSince((state) => state.byKey);
    const nodes = useProjectNodes();

    const groups = groupAttention(nodes, sessions, chats, endpointId, unseen, snoozes);
    const waiting = new Set(groups.needsYou);
    const waitingIds = oldestWaitingFirst(
        nodes.filter((node) => waiting.has(node.id)),
        sessions,
        chats,
        since,
        endpointId
    ).map((node) => node.id);
    if (groups.needsYou.length === 0 && groups.working.length === 0 && groups.finished.length === 0) {
        return null;
    }

    return (
        <>
            <div className="flex items-center gap-1">
                {groups.needsYou.length > 0 && (
                    <Walker
                        label={t('status.nextNeedsYou')}
                        detail={<WaitingLines nodes={nodes} ids={waitingIds} />}
                        count={groups.needsYou.length}
                        ids={waitingIds}
                    >
                        <StatusDot status="needs-you" plain />
                    </Walker>
                )}
                {groups.working.length > 0 && (
                    <Tooltip label={t('status.working')}>
                        <span
                            role="status"
                            aria-label={t('status.workingCount', { count: groups.working.length })}
                            className="flex h-8 items-center gap-1.5 px-3 text-xs font-medium tabular-nums text-text-muted"
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
