import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleCheck } from 'lucide-react';
import { useProjectNodes } from '@/project/view-nodes';
import { revealNode } from '@/project/views';
import { groupAttention, useAttention } from '@/state/attention';
import { shownChatOfNode } from '@/design/design-chat';
import { useCanvasStore } from '@/state/canvas';
import { useChats } from '@adecore/agents-react/state';
import { useEndpointId } from '@/state/keys';
import { useSessions } from '@/state/sessions';
import { useSnoozes } from '@/state/snooze';
import { StatusDot } from '@/canvas/NodeFrame';
import { Button, Icon, Separator, Tooltip } from '@adecore/ui';

/* A count that walks through the nodes behind it, across views, one per click. */
function Walker({ label, count, ids, children }: { label: string; count: number; ids: string[]; children: ReactNode }) {
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
        <Tooltip label={label} name>
            <Button className="tabular-nums" onClick={next}>
                {children}
                {count}
            </Button>
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
    const endpointId = useEndpointId();
    const sessions = useSessions((s) => s.byKey);
    const chats = useChats((s) => s.statusByKey);
    const unseen = useAttention((s) => s.unseen);
    const snoozes = useSnoozes((s) => s.byKey);
    const nodes = useProjectNodes();

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
