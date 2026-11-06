import i18next from 'i18next';
import { nextWaitingTitle, revealNextWaiting } from '@/attention/next-waiting';
import { openAttentionQueue } from '@/attention/queue';
import { defineBehaviors, takeKey } from '@/commands/behavior';
import { focusPromptStack } from '@/surface/canvas/prompt-stack';

export const ATTENTION_BEHAVIORS = defineBehaviors({
    // From anywhere, a terminal included: the point is to answer without first leaving what you type in.
    prompts: {
        run: () => void focusPromptStack(),
        key: (press) => {
            if (focusPromptStack()) {
                press.event.preventDefault();
            }

            return true;
        }
    },
    'needs-you-next': {
        run: () => void revealNextWaiting(),
        offered: (moment) => moment.inWorkspace && { hint: nextWaitingTitle() ?? i18next.t('shell:palette.hints.nothingWaits') },
        afterClose: true,
        key: (press) => {
            if (revealNextWaiting()) {
                press.event.preventDefault();
            }

            return true;
        }
    },
    'attention-queue': {
        run: openAttentionQueue,
        offered: (moment) => moment.inWorkspace,
        afterClose: true,
        key: (press) => takeKey(press, openAttentionQueue)
    }
});
