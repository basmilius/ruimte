import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePulsarAccount } from '@/pulsar/account';
import { accountName } from '@/pulsar/account-name';
import { forgetAccountMachines, refreshAccountMachines, usePulsarMachines } from '@/pulsar/machines';
import { AccountAvatar } from '@/shell/settings/AccountAvatar';
import { Skeleton } from '@ruimte/ui/controls';
import { MachineDetail } from '@/shell/settings/MachineDetail';
import { MachineListItem } from '@/shell/settings/MachineListItem';
import { MasterDetail, MasterItem } from '@ruimte/ui/settings/MasterDetail';
import { currentPick, mergeMachines, pickForTarget, type MachinePick } from '@/shell/settings/machine-list';
import { RuimteAccountDetail } from '@/shell/settings/RuimteAccountDetail';
import { useEndpoints } from '@/state/endpoints';
import { hasLocalMachine } from '@/state/local-machine';
import { useUi } from '@/state/ui';
import { Button } from '@ruimte/ui/Button';
import { SECTION_LABEL } from '@ruimte/ui/classes';
import { ErrorBoundary } from '@ruimte/ui/ErrorBoundary';
import { Icon } from '@ruimte/ui/Icon';

/*
 * The Ruimte account and one list of machines beside the detail of what is picked. The list joins the
 * rows of this client (this machine, and every machine paired by link) with the machines on the
 * account, one entry per machine id.
 */
export function MachinesPane() {
    const { t } = useTranslation('settings');
    const endpoints = useEndpoints((s) => s.endpoints);
    const status = usePulsarAccount((s) => s.status);
    const account = usePulsarAccount((s) => s.account);
    const machines = usePulsarMachines((s) => s.machines);
    const machinesError = usePulsarMachines((s) => s.error);
    const target = useUi((s) => s.settings.target);
    const [picked, setPicked] = useState<MachinePick | null>(null);
    const [focusPairing, setFocusPairing] = useState(0);

    // An open pane is one of the moments a client learns what the account says, removals included.
    useEffect(() => {
        if (status === 'signed-in') {
            void refreshAccountMachines();
        } else if (status === 'signed-out') {
            forgetAccountMachines();
        }
    }, [status]);

    const signedIn = status === 'signed-in';
    const entries = mergeMachines({ endpoints, accountMachines: signedIn ? machines : null, showLocal: hasLocalMachine() });
    const current = currentPick(picked, entries);
    const currentEntry = current.kind === 'machine' ? (entries.find((entry) => entry.id === current.id) ?? null) : null;

    const [seenTarget, setSeenTarget] = useState<string | null>(null);
    if (target !== seenTarget) {
        setSeenTarget(target);
        const next = target === null ? null : pickForTarget(target, entries, currentEntry);
        if (next !== null) {
            setPicked(next);
        }
    }

    const addMachine = (): void => {
        setPicked({ kind: 'account' });
        setFocusPairing((count) => count + 1);
    };

    const list = (
        <>
            <MasterItem selected={current.kind === 'account'} onSelect={() => setPicked({ kind: 'account' })} className="min-h-14">
                <AccountAvatar account={signedIn ? account : null} />
                <span className="flex min-w-0 grow flex-col">
                    <span className="truncate text-sm text-text">{t('machines.account.row')}</span>
                    {status === 'loading' ? (
                        <Skeleton className="my-0.5 w-28" />
                    ) : (
                        <span className="truncate text-xs text-text-muted">{signedIn && account ? accountName(account) : t('nav.account.signedOut')}</span>
                    )}
                </span>
            </MasterItem>
            <div className="mt-2 flex min-w-0 shrink-0 items-center gap-2 border-t border-border pt-2.5 pl-3">
                <span className={clsx(SECTION_LABEL, 'grow')}>{t('machines.title')}</span>
                <Button size="sm" onClick={addMachine}>
                    <Icon icon={Plus} size={14} />
                    {t('machines.add.short')}
                </Button>
            </div>
            {entries.length === 0 && (
                <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
                    <span className="text-sm text-text-muted">{t('machines.empty.label')}</span>
                    <span className="text-xs break-words text-text-faint">{t('machines.empty.description')}</span>
                </div>
            )}
            {entries.map((entry) => (
                <MachineListItem
                    key={entry.id}
                    entry={entry}
                    selected={current.kind === 'machine' && current.id === entry.id}
                    onSelect={() => setPicked({ kind: 'machine', id: entry.id })}
                />
            ))}
            {signedIn && machines === null && machinesError === null && (
                <div className="flex flex-col gap-1.5 px-3 py-2">
                    <Skeleton className="w-40" />
                    <Skeleton className="w-24" />
                </div>
            )}
            {signedIn && machinesError !== null && (
                <p className="px-3 py-2 text-xs break-words text-status-error" role="alert">
                    {machinesError}
                </p>
            )}
        </>
    );

    return (
        <MasterDetail
            listWidth={320}
            listLabel={t('machines.listLabel')}
            list={list}
            detail={
                <ErrorBoundary label={t('machines.failed')} resetKeys={[current.kind, currentEntry?.id]}>
                    <div className="flex min-w-0 flex-col gap-7">
                        {currentEntry !== null ? (
                            <MachineDetail key={currentEntry.id} entry={currentEntry} />
                        ) : (
                            <RuimteAccountDetail focusPairing={focusPairing} />
                        )}
                    </div>
                </ErrorBoundary>
            }
        />
    );
}
