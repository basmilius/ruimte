import { Skeleton } from '@adecore/ui';
import { Tabs } from '@base-ui/react/tabs';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AccountAvatar } from '@/machine-ui/AccountAvatar';
import { useMachineEntries } from '@/machines/use-machine-entries';
import { usePulsarAccount } from '@/pulsar/account';
import { accountName } from '@/pulsar/account-name';
import { usePulsarMachines } from '@/state/pulsar-machines';
import { refreshAccountMachines } from '@/workspace/account-machines';

export function AccountTab({ sectionId }: { sectionId: string }) {
    const { t } = useTranslation('settings');
    const status = usePulsarAccount((s) => s.status);
    const account = usePulsarAccount((s) => s.account);
    const accountMachines = usePulsarMachines((s) => s.machines);
    const signedIn = status === 'signed-in' && account !== null;
    const count = useMachineEntries().length;
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
            value={sectionId}
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
