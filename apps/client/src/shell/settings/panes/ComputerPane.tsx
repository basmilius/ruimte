import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComputerGrant } from '@ruimte/contracts';
import { canSwitch, showsGrants, type ComputerSetup } from '@/computer/setup';
import { GrantRows, SetupLine } from '@/computer/ComputerSetupRows';
import { useComputerMachine } from '@/computer/use-computer-machine';
import { SettingsRow } from '@adecore/ui/settings';
import { Switch, Button, ErrorBoundary, FormError } from '@adecore/ui';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { ComputerAppGrants } from '@/shell/settings/panes/ComputerAppGrants';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { listedEndpoints } from '@/state/local-machine';

export function ComputerPane() {
    const { t } = useTranslation('settings');
    return (
        <ErrorBoundary label={t('computer.failed')} className="relative" compact>
            <ComputerSection />
        </ErrorBoundary>
    );
}

/* A block per machine, like every setting an agent is held to: the machine enforces it, so each keeps its own. */
function ComputerSection() {
    const stored = useEndpoints((s) => s.endpoints);
    const endpoints = useMemo(() => listedEndpoints(stored), [stored]);
    const ordered = [
        ...endpoints.filter((endpoint) => endpoint.id === LOCAL_ENDPOINT_ID),
        ...endpoints.filter((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID)
    ];
    return (
        <>
            {ordered.map((endpoint, index) => (
                <ComputerMachine key={endpoint.id} endpoint={endpoint} first={index === 0} />
            ))}
        </>
    );
}

function ComputerMachine({ endpoint, first }: { endpoint: Endpoint; first: boolean }) {
    const { t } = useTranslation('settings');
    const { connected, status, grants, setup, local, busy, error, setEnabled, openGrant, checkAgain, revoke } = useComputerMachine(endpoint.id);

    return (
        <>
            <SettingsSection>
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
