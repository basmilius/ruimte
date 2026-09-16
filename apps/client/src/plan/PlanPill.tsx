import clsx from 'clsx';
import { ListChecks, LoaderCircle } from 'lucide-react';
import { activeStepIds } from '@ruimte/plan';
import { openPlanFromPill } from '@/plan/plan-panel-watch';
import { hasFailedStep, planCounter } from '@/plan/plan-view';
import { chatWorking } from '@/state/agent-work';
import { useChatRow } from '@/state/chats';
import { endpointKey, useEndpointId } from '@/state/keys';
import { useChatPlans, usePlans } from '@/state/plans';
import { useUi } from '@/state/ui';
import { Icon } from '@/ui/Icon';
import { Pill } from '@/ui/Pill';
import { Tooltip } from '@/ui/Tooltip';

/*
 * "Plan 6/11" in a chat's header, only while the chat has a plan. A red dot for a failed step, an
 * accent dot for a plan nobody has opened yet, and a small ring while the agent works on a step.
 * Pressing it puts the plan in the panel, even after the panel was closed.
 */
export function PlanPill({ chatId }: { chatId: string }) {
    const endpointId = useEndpointId();
    const plans = useChatPlans(chatId);
    const unseenId = usePlans((s) => s.unseen[endpointKey(endpointId, chatId)] ?? null);
    const anchoredPlanId = useUi((s) => (s.planAnchor?.chatId === chatId ? s.planAnchor.planId : null));
    const working = useChatRow(chatId, (row) => chatWorking(row));
    const plan = plans.find((entry) => entry.id === (unseenId ?? anchoredPlanId)) ?? plans[0];
    const unseen = unseenId !== null;
    if (!plan) {
        return null;
    }
    const failed = hasFailedStep(plan);
    const busy = working && activeStepIds(plan).length > 0;
    const label = [plan.meta.title, plans.length > 1 ? `${plans.length} plans in this chat` : null, unseen ? 'New plan' : null, failed ? 'A step failed' : null]
        .filter((part): part is string => part !== null)
        .join('. ');
    return (
        <Tooltip label={label}>
            <Pill
                className="tabular-nums"
                icon={<Icon icon={busy ? LoaderCircle : ListChecks} size={12} className={clsx(busy && 'animate-spin text-accent')} />}
                onClick={() => openPlanFromPill(chatId, plan.id)}
            >
                Plan {planCounter(plan)}
                {(failed || unseen) && (
                    <span className="flex items-center gap-0.5" aria-hidden>
                        {failed && <span className="h-1.5 w-1.5 rounded-full bg-status-error" />}
                        {unseen && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                    </span>
                )}
            </Pill>
        </Tooltip>
    );
}
