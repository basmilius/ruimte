import { useTranslation } from 'react-i18next';
import type { AgentKind } from '@ruimte/contracts';
import { AccountDot } from '@/agents/AccountDot';
import { useAccountChoice } from '@/chat/account-choice';
import { useChats } from '@/state/chats';
import { endpointKey, useEndpointId } from '@/state/keys';
import { Pill } from '@ruimte/ui/Pill';
import { Tooltip } from '@ruimte/ui/Tooltip';

function AccountPillOf({ provider, account }: { provider: AgentKind; account: string | undefined }) {
    const { t } = useTranslation('chat');
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
    const endpointId = useEndpointId();
    const provider = useChats((s) => s.statusByKey[endpointKey(endpointId, chatId)]?.info.provider);
    const account = useChats((s) => s.statusByKey[endpointKey(endpointId, chatId)]?.info.account);
    return provider === undefined ? null : <AccountPillOf provider={provider} account={account} />;
}
