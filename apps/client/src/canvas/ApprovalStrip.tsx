import { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { ApprovalChoice } from '@ruimte/contracts';
import { useSessionRow } from '@/state/sessions';
import { useEndpointId } from '@/state/keys';
import { useSettings } from '@/state/settings';
import { sessionClientFor } from '@/transport/connections';
import { DOCK_ICON_SIZE, toolIcon } from '@/chat/ui/icons';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

/* The Allow of a strip is its primary button; a remembered rule is the quieter way to say the same thing. */
const variantOf = (kind: ApprovalChoice['kind']): 'primary' | 'ghost' => (kind === 'allow' ? 'primary' : 'ghost');

/*
 * The permission a terminal agent is waiting on, under the node's own header. The CLI is asking in
 * its own screen at the same moment and either answer settles it, so this strip goes away on its own
 * when the person types into the terminal instead, or when another client is first.
 */
export function ApprovalStrip({ id }: { id: string }) {
    const endpointId = useEndpointId();
    const request = useSessionRow(id, (row) => row?.approvals?.[0]);
    const more = useSessionRow(id, (row) => Math.max((row?.approvals?.length ?? 0) - 1, 0));
    // The daemon is told as well, so it holds nothing for this client; this is what takes a strip off
    // the moment the switch flips, including one another client is still being asked in its own window.
    const offered = useSettings((s) => s.agentsApprovals);
    const [answering, setAnswering] = useState(false);

    if (!offered || !request) {
        return null;
    }

    const answer = (choiceId: string) => {
        setAnswering(true);
        void sessionClientFor(endpointId)
            ?.answerApproval(id, request.requestId, choiceId)
            .finally(() => setAnswering(false));
    };

    return (
        <div
            className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-3 py-2 text-xs"
            role="group"
            aria-label={`${request.toolName} wants permission`}
            onPointerDown={(e) => e.stopPropagation()}
        >
            <span className="grid h-6 w-6 shrink-0 place-items-center text-status-needs-you">{toolIcon(request.toolName, DOCK_ICON_SIZE)}</span>
            <span className="shrink-0 text-sm font-medium text-text">{request.toolName}</span>
            <span className="min-w-0 grow truncate font-mono text-text-muted">{request.summary || 'wants to run'}</span>
            {more > 0 && <span className="shrink-0 tabular-nums text-text-faint">{more} more</span>}
            {request.choices.map((choice) => (
                <Button key={choice.id} size="sm" variant={variantOf(choice.kind)} disabled={answering} className="shrink-0" onClick={() => answer(choice.id)}>
                    {choice.kind === 'allow' && <Icon icon={Check} size={12} />}
                    {choice.kind === 'deny' && <Icon icon={X} size={12} />}
                    {choice.label}
                </Button>
            ))}
        </div>
    );
}
