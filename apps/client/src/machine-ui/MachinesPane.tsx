import { Skeleton, Button, ErrorBoundary, Icon, SectionLabel } from '@adecore/ui';
import { MasterDetail, MasterItem } from '@adecore/ui/settings';
import { Laptop, Plus } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isDesktop } from '@/desktop/bridge';
import { AccountAvatar } from '@/machine-ui/AccountAvatar';
import { candidateKey, useMachineCandidates } from '@/machine-ui/machine-candidates';
import { MachineCandidateDetail } from '@/machine-ui/MachineCandidateDetail';
import { MachineCandidateItem } from '@/machine-ui/MachineCandidateItem';
import { MachineDetail } from '@/machine-ui/MachineDetail';
import { MachineListItem } from '@/machine-ui/MachineListItem';
import { RuimteAccountDetail } from '@/machine-ui/RuimteAccountDetail';
import { ThisComputerDetail } from '@/machine-ui/ThisComputerDetail';
import { currentPick, pickForTarget, type MachinePick } from '@/machines/machine-list';
import { useMachineEntries } from '@/machines/use-machine-entries';
import { usePulsarAccount } from '@/pulsar/account';
import { accountName } from '@/pulsar/account-name';
import { useEndpointId } from '@/state/current-endpoint';
import { hasLocalMachine } from '@/state/local-machine';
import { usePulsarMachines } from '@/state/pulsar-machines';
import { useUi } from '@/state/ui';
import { forgetAccountMachines, refreshAccountMachines } from '@/workspace/account-machines';

/*
 * The Ruimte account and one list of machines beside the detail of what is picked. The list joins the
 * rows of this client (this machine, and every machine it opened) with the machines on the account,
 * one entry per machine id.
 */
export function MachinesPane() {
    const { t } = useTranslation('settings');
    const status = usePulsarAccount((s) => s.status);
    const account = usePulsarAccount((s) => s.account);
    const machines = usePulsarMachines((s) => s.machines);
    const machinesError = usePulsarMachines((s) => s.error);
    const target = useUi((s) => s.settings.target);
    const [picked, setPicked] = useState<MachinePick | null>(null);
    const windowEndpointId = useEndpointId();

    // An open pane is one of the moments a client learns what the account says, removals included.
    useEffect(() => {
        if (status === 'signed-in') {
            void refreshAccountMachines();
        } else if (status === 'signed-out') {
            forgetAccountMachines();
        }
    }, [status]);

    const signedIn = status === 'signed-in';
    const entries = useMachineEntries();
    const offersThisComputer = isDesktop() && !hasLocalMachine();
    const current = currentPick(picked, entries, offersThisComputer);
    const currentEntry = current.kind === 'machine' ? (entries.find((entry) => entry.id === current.id) ?? null) : null;

    // A place an extension can start a machine in is no machine yet, so it is picked apart from the machines and wins while it is listed.
    const { projectId, candidates } = useMachineCandidates();
    const [pickedCandidate, setPickedCandidate] = useState<string | null>(null);
    const currentCandidate = candidates.find((candidate) => candidateKey(candidate) === pickedCandidate) ?? null;
    const pick = (next: MachinePick): void => {
        setPickedCandidate(null);
        setPicked(next);
    };

    const [seenTarget, setSeenTarget] = useState<string | null>(null);
    if (target !== seenTarget) {
        setSeenTarget(target);
        const next = target === null ? null : pickForTarget(target, entries, currentEntry, windowEndpointId);
        if (next !== null) {
            setPickedCandidate(null);
            setPicked(next);
        }
    }

    const shown = currentCandidate === null ? current.kind : 'candidate';

    const list = (
        <>
            <MasterItem selected={shown === 'account'} onSelect={() => pick({ kind: 'account' })} className="min-h-14">
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
            {offersThisComputer && (
                <MasterItem selected={shown === 'this-computer'} onSelect={() => pick({ kind: 'this-computer' })} className="mt-1 min-h-14">
                    <span className="grid size-7.5 shrink-0 place-items-center rounded-lg bg-surface-hover">
                        <Icon icon={Laptop} size={16} className="text-text-muted" />
                    </span>
                    <span className="flex min-w-0 grow flex-col">
                        <span className="truncate text-sm text-text">{t('machines.thisComputer.row')}</span>
                        <span className="truncate text-xs text-text-muted">{t('machines.thisComputer.none')}</span>
                    </span>
                </MasterItem>
            )}
            <div className="mt-2 flex min-w-0 shrink-0 items-center gap-2 border-t border-border pt-2.5 pl-3">
                <SectionLabel className="grow">{t('machines.title')}</SectionLabel>
                <Button size="sm" onClick={() => pick({ kind: 'account' })}>
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
                    selected={shown === 'machine' && current.kind === 'machine' && current.id === entry.id}
                    onSelect={() => pick({ kind: 'machine', id: entry.id })}
                />
            ))}
            {signedIn && machines === null && machinesError === null && (
                <div className="flex flex-col gap-1.5 px-3 py-2">
                    <Skeleton className="w-40" />
                    <Skeleton className="w-24" />
                </div>
            )}
            {candidates.map((candidate, index) => {
                const before = candidates[index - 1]?.source;
                const opensSource = before?.extension !== candidate.source.extension || before.id !== candidate.source.id;

                return (
                    <Fragment key={candidateKey(candidate)}>
                        {opensSource && (
                            <div className="mt-2 flex min-w-0 shrink-0 items-center border-t border-border pt-2.5 pl-3">
                                <SectionLabel className="grow">{t('machines.sources.title', { source: candidate.source.title })}</SectionLabel>
                            </div>
                        )}
                        <MachineCandidateItem
                            candidate={candidate}
                            selected={currentCandidate === candidate}
                            onSelect={() => setPickedCandidate(candidateKey(candidate))}
                        />
                    </Fragment>
                );
            })}
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
                <ErrorBoundary label={t('machines.failed')} resetKeys={[shown, currentEntry?.id, pickedCandidate]}>
                    <div className="flex min-w-0 flex-col gap-7">
                        {currentCandidate !== null && projectId !== null ? (
                            <MachineCandidateDetail key={candidateKey(currentCandidate)} projectId={projectId} candidate={currentCandidate} />
                        ) : current.kind === 'this-computer' ? (
                            <ThisComputerDetail />
                        ) : currentEntry !== null ? (
                            <MachineDetail key={currentEntry.id} entry={currentEntry} />
                        ) : (
                            <RuimteAccountDetail />
                        )}
                    </div>
                </ErrorBoundary>
            }
        />
    );
}
