import { useState } from 'react';
import { MousePointer2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ComputerGrant } from '@ruimte/contracts';
import { canSwitch, showsGrants, type ComputerSetup } from '@/computer/setup';
import { GrantRows, SetupLine } from '@/computer/ComputerSetupRows';
import { useComputerMachine } from '@/computer/use-computer-machine';
import { desktop, isDesktop } from '@/desktop/bridge';
import { SettingsRow } from '@adecore/ui/settings';
import { Switch, Button, ErrorBoundary, FormError } from '@adecore/ui';
import { SetUpMachineDialog } from '@/shell/settings/SetUpMachineDialog';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { WithReason } from '@/shell/settings/MachineSettings';
import { useListedMachines } from '@/shell/settings/machine-list';
import { ComputerAppGrants } from '@/shell/settings/panes/ComputerAppGrants';
import type { Endpoint } from '@/state/endpoints';
import { hasLocalMachine } from '@/state/local-machine';

/* Computer use under Agents: it is something an agent may do, held to by the machine that runs it. */
export function ComputerSections() {
    const { t } = useTranslation('settings');
    return (
        <ErrorBoundary label={t('computer.failed')} className="relative" compact>
            <ComputerSection />
        </ErrorBoundary>
    );
}

/* A block per machine, like every setting an agent is held to: the machine enforces it, so each keeps its own. */
function ComputerSection() {
    const ordered = useListedMachines();
    // Computer use acts on the computer its machine runs on, so a Mac whose app runs none has nothing to switch on.
    const thisMac = isDesktop() && !hasLocalMachine() && desktop()?.platform === 'darwin';
    return (
        <>
            {thisMac && <ThisMacUnavailable />}
            {ordered.map((endpoint, index) => (
                <ComputerMachine key={endpoint.id} endpoint={endpoint} first={index === 0 && !thisMac} />
            ))}
        </>
    );
}

function ThisMacUnavailable() {
    const { t } = useTranslation('settings');
    const [confirming, setConfirming] = useState(false);
    return (
        <SettingsSection title={t('computer.title')} description={t('computer.description')} icon={MousePointer2}>
            <SettingsRow
                searchId="computer.enable"
                muted
                label={t('computer.thisMac.label')}
                description={t('computer.thisMac.description')}
                control={
                    <span className="flex items-center gap-2">
                        <Button variant="secondary" onClick={() => setConfirming(true)}>
                            {t('computer.thisMac.setUp')}
                        </Button>
                        <WithReason reason={t('computer.thisMac.reason')}>
                            <Switch checked={false} disabled label={t('computer.thisMac.label')} onCheckedChange={() => undefined} />
                        </WithReason>
                    </span>
                }
            />
            <SetUpMachineDialog open={confirming} onOpenChange={setConfirming} />
        </SettingsSection>
    );
}

function ComputerMachine({ endpoint, first }: { endpoint: Endpoint; first: boolean }) {
    const { t } = useTranslation('settings');
    const { connected, status, grants, setup, local, busy, error, setEnabled, openGrant, checkAgain, revoke } = useComputerMachine(endpoint.id);

    return (
        <>
            <SettingsSection title={t('computer.title')} description={t('computer.description')} icon={MousePointer2}>
                <SettingsRow
                    searchId={first ? 'computer.enable' : undefined}
                    label={t('computer.enable', { machine: endpoint.label })}
                    description={connected ? <SetupLine setup={setup} /> : t('computer.machine.notConnected')}
                    control={
                        <Switch
                            checked={status?.enabled === true}
                            label={t('computer.enable', { machine: endpoint.label })}
                            disabled={!connected || busy || !canSwitch(setup)}
                            onCheckedChange={setEnabled}
                        />
                    }
                >
                    {(error ?? status?.problem) && <FormError>{error ?? status?.problem}</FormError>}
                </SettingsRow>
            </SettingsSection>
            {connected && showsGrants(setup) && (
                <GrantSection setup={setup} local={local} busy={busy} machine={endpoint.label} first={first} onOpen={openGrant} onCheck={checkAgain} />
            )}
            {connected && status?.enabled === true && grants !== null && <ComputerAppGrants grants={grants} busy={busy} onRevoke={revoke} />}
        </>
    );
}

interface GrantSectionProps {
    setup: ComputerSetup;
    // This Mac, whose System Settings the shell can open.
    local: boolean;
    busy: boolean;
    machine: string;
    first: boolean;
    onOpen(grant: ComputerGrant): void;
    onCheck(): void;
}

function GrantSection({ setup, local, busy, machine, first, onOpen, onCheck }: GrantSectionProps) {
    const { t } = useTranslation('settings');
    const restart = setup.screenRecording === 'missing';
    const footer = !local && setup.phase !== 'ready' ? t('computer.remote', { machine }) : local && restart ? t('computer.restartNote') : undefined;
    return (
        <SettingsSection
            title={t('computer.permissions')}
            footer={footer}
            action={
                restart && (
                    <Button disabled={busy} onClick={onCheck}>
                        {t('computer.checkAgain')}
                    </Button>
                )
            }
        >
            <GrantRows setup={setup} local={local} busy={busy} searchable={first} onOpen={onOpen} />
        </SettingsSection>
    );
}
