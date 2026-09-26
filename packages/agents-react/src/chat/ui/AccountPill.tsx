import { useTranslation } from 'react-i18next';
import type { AgentKind } from '@ruimte/agent-contracts';
import { AccountDot } from '../../agents/AccountDot';
import { useAccountChoice } from '../account-choice';
import { useChats } from '../../state/chats';
import { useChatScope } from '../../scope';
import { Pill } from '@ruimte/ui/Pill';
import { Tooltip } from '@ruimte/ui/Tooltip';

function AccountPillOf({ provider, account }: { provider: AgentKind; account: string | undefined }) {
    const { t } = useTranslation('agent-chat');
    const choice = useAccountChoice(provider, account);
    if (choice === null) {
        return null;
    }
    const name = choice.current === null ? choice.currentId : choice.nameOf(choice.current);
    return (
        <Tooltip label={t('account.pill', { provider: choice.providerName, account: name })}>
            <Pill icon={<AccountDot color={choice.current?.account.color} className="size-1.75" />}>
                <span className="max-w-32 truncate">{name}</span>
            </Pill>
        </Tooltip>
    );
}

/* Which account a chat node runs under, from the status every client gets; only while its CLI has a choice of accounts. */
export function AccountPill({ chatId }: { chatId: string }) {
    const { keyOf } = useChatScope();
    const provider = useChats((s) => s.statusByKey[keyOf(chatId)]?.info.provider);
    const account = useChats((s) => s.statusByKey[keyOf(chatId)]?.info.account);
    return provider === undefined ? null : <AccountPillOf provider={provider} account={account} />;
}
