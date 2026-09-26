import { useRef } from 'react';
import { CirclePause, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Plan } from '@ruimte/contracts';
import { useHeld } from '@/plan/hold';
import { revealPlanStep } from '@/plan/plan-actions';
import { usePlanAgent } from '@/plan/plan-agent';
import { activeSteps, activeStepsLabel, nextActiveTarget, sameActiveSteps } from '@/plan/plan-view';
import { chatWorking } from '@/state/agent-work';
import { useChatRow } from '@ruimte/agents-react/state/chats';
import { Icon } from '@ruimte/ui/Icon';
import { Tooltip } from '@ruimte/ui/Tooltip';

// Long enough to bridge an agent closing one step before it opens the next, short enough that a stop still shows soon.
export const ACTIVE_HOLD_MS = 1500;

const sameFlag = (a: true, b: true): boolean => a === b;

/**
 * The step the agent is on, as one icon button in the plan panel's toolbar. It keeps its slot while
 * nothing is active, so the buttons beside it never move, and a click walks through the active steps.
 *
 * @param chatId The chat the plan belongs to.
 * @param plan The plan the panel shows.
 * @param planKey The key of the plan's view state, from `planViewKey`.
 */
export function ActiveStepButton({ chatId, plan, planKey }: { chatId: string; plan: Plan; planKey: string }) {
    const { t } = useTranslation('plan');
    const live = activeSteps(plan);
    const steps = useHeld(live.length > 0 ? live : null, sameActiveSteps, ACTIVE_HOLD_MS);
    const liveWorking = useChatRow(chatId, (row) => chatWorking(row));
    const working = useHeld<true>(liveWorking ? true : null, sameFlag, ACTIVE_HOLD_MS) === true;
    const agent = usePlanAgent(chatId);
    const last = useRef<string | null>(null);

    if (steps === null) {
        return <span className="icon-btn invisible" aria-hidden />;
    }

    const title = activeStepsLabel(steps);
    const label = working ? title : `${title}. ${t('agent.stoppedHere', { agent })}`;
    const go = (): void => {
        const target = nextActiveTarget(steps, last.current);
        if (target === null) {
            return;
        }
        last.current = target;
        revealPlanStep(planKey, plan, target);
    };

    return (
        <Tooltip label={label} name>
            <button type="button" className="icon-btn" onClick={go}>
                {working ? (
                    <Icon icon={LoaderCircle} size={16} className="animate-spin text-accent" />
                ) : (
                    <Icon icon={CirclePause} size={16} className="text-text-muted" />
                )}
            </button>
        </Tooltip>
    );
}
