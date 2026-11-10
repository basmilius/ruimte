import { Icon, Pill, Tooltip } from '@adecore/ui';
import { Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { pullRequestDialog } from '@/github/dialogs';
import { useChatPrWatch } from '@/github/pr-watches';

const PR_CHECK_TONES = { failure: 'error', success: 'idle', pending: 'muted', none: 'muted' } as const;

/* The pull request a chat watches, with how its checks stand; pressing it opens the dialog of that pull request. */
export function PrWatchPill({ chatId }: { chatId: string }) {
    const { t } = useTranslation('canvas');
    const watch = useChatPrWatch(chatId);
    if (watch === null) {
        return null;
    }
    return (
        <Tooltip label={t('node.prWatchPill', { pr: `${watch.repo}#${watch.number}`, state: t(`node.prWatchState.${watch.checkState}`) })}>
            <Pill mono tone={PR_CHECK_TONES[watch.checkState]} icon={<Icon icon={Eye} size={12} />} onClick={() => pullRequestDialog.set({ cwd: watch.cwd })}>
                PR #{watch.number}
            </Pill>
        </Tooltip>
    );
}
