import { useEffect, useMemo } from 'react';
import { Tabs } from '@base-ui-components/react/tabs';
import { useTranslation } from 'react-i18next';
import { usePulsarAccount } from '@/pulsar/account';
import { accountName } from '@/pulsar/account-name';
import { refreshAccountMachines, usePulsarMachines } from '@/pulsar/machines';
import { AccountAvatar } from '@/shell/settings/AccountAvatar';
import { mergeMachines } from '@/shell/settings/machine-list';
import { ACCOUNT_SECTION } from '@/shell/settings/sections';
import { useEndpoints } from '@/state/endpoints';
import { hasLocalMachine } from '@/state/local-machine';
import { Skeleton } from '@ruimte/ui/controls';

/* Who this client is signed in as, and how many machines it knows; it opens the Account pane. */
export function AccountTab() {
    const { t } = useTranslation('settings');
    const status = usePulsarAccount((s) => s.status);
    const account = usePulsarAccount((s) => s.account);
    const accountMachines = usePulsarMachines((s) => s.machines);
    const endpoints = useEndpoints((s) => s.endpoints);
    const signedIn = status === 'signed-in' && account !== null;
    const count = useMemo(
        () => mergeMachines({ endpoints, accountMachines: signedIn ? accountMachines : null, showLocal: hasLocalMachine() }).length,
        [endpoints, accountMachines, signedIn]
    );
    const name = signedIn ? accountName(account) : null;

    // The count includes the account's machines, which this client only learns by asking. The Account pane asks again whenever it opens.
    const unknown = signedIn && accountMachines === null;
    useEffect(() => {
        if (unknown) {
            void refreshAccountMachines();
        }
    }, [unknown]);

    return (
        <Tabs.Tab
            value={ACCOUNT_SECTION.id}
            className="flex w-full min-w-0 shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left focus-visible:-outline-offset-2 hover:bg-surface-hover data-active:bg-surface-active"
        >
            <AccountAvatar account={signedIn ? account : null} />
            <span className="flex min-w-0 flex-col">
                {status === 'loading' ? (
                    <Skeleton className="my-0.5 w-28" />
                ) : (
                    <span className="truncate text-xs text-text">{name ?? t('nav.account.signedOut')}</span>
                )}
                <span className="truncate text-xs text-text-muted">{t('nav.account.machines', { count })}</span>
            </span>
        </Tabs.Tab>
    );
}
