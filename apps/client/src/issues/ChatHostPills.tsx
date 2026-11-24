import { Icon, Pill, Tooltip } from '@adecore/ui';
import type { HostChange } from '@ruimte/contracts';
import { CircleDot, GitPullRequest } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChatChangeRead, useChatHostFacts, type ChatHostFacts } from '@/issues/chat-facts';
import { issueDialog } from '@/issues/dialogs';
import { CHECK_COLORS, CHECK_ICONS, shortRef } from '@/issues/look';

const SHOWN_ISSUES = 2;

function ChangePill({ change }: { change: HostChange }) {
    const { t } = useTranslation('issues');
    const state = change.draft === true ? t('state.draft') : (change.stateLabel ?? t(`state.${change.state}`));
    const hint =
        change.checkState === undefined
            ? t('chat.changeHint', { title: change.title, state })
            : t('chat.changeChecksHint', { title: change.title, state, checks: t(`checks.${change.checkState}`) });

    const pill = (
        <Pill tone="raised" icon={<Icon icon={GitPullRequest} size={12} />}>
            <span className="sr-only">{t('chat.change')}</span>
            {change.checkState !== undefined && <Icon icon={CHECK_ICONS[change.checkState]} size={12} className={CHECK_COLORS[change.checkState]} />}
        </Pill>
    );

    return (
        <Tooltip label={hint}>
            {change.url === undefined ? (
                pill
            ) : (
                <a href={change.url} target="_blank" rel="noreferrer" aria-label={hint}>
                    {pill}
                </a>
            )}
        </Tooltip>
    );
}

/* What a chat works on, in its node's header or its view's toolbar: its issues, and its change with the state of its checks. */
export function HostPills({ links, change }: ChatHostFacts) {
    const { t } = useTranslation('issues');

    return (
        <>
            {links.slice(0, SHOWN_ISSUES).map((link) => (
                <Tooltip key={link.ref} label={t('chat.issue', { title: link.title })}>
                    <Pill
                        tone="raised"
                        className="max-w-32"
                        icon={<Icon icon={CircleDot} size={12} />}
                        onClick={() => issueDialog.open({ ref: link.ref, title: link.title })}
                    >
                        <span className="truncate">{shortRef(link.ref)}</span>
                    </Pill>
                </Tooltip>
            ))}
            {links.length > SHOWN_ISSUES && <Pill>{t('chat.issues', { count: links.length })}</Pill>}
            {change !== null && <ChangePill change={change} />}
        </>
    );
}

export function ChatHostPills({ chatId }: { chatId: string }) {
    useChatChangeRead(chatId);

    return <HostPills {...useChatHostFacts(chatId)} />;
}
