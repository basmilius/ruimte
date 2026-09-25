import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { ComputerGrant, ComputerRevokePayload, ComputerUseStatus } from '@ruimte/contracts';
import {
    canSwitch,
    COMPUTER_GRANTS,
    computerSetupOf,
    opensSystemSettings,
    recheckOf,
    setupLine,
    showsGrants,
    SYSTEM_SETTINGS_PANES,
    type ComputerSetup,
    type GrantState
} from '@/computer/setup';
import { desktop } from '@/desktop/bridge';
import { activeLanguage } from '@/i18n/active';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Toggle } from '@/shell/settings/controls';
import { ComputerAppGrants } from '@/shell/settings/panes/ComputerAppGrants';
import { useComputer } from '@/state/computer';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { listedEndpoints } from '@/state/local-machine';
import { useServers } from '@/state/server';
import { transportFor } from '@/transport';
import { useEndpointConnection } from '@/transport/status';
import type { Transport } from '@/transport/transport';
import { Button } from '@/ui/Button';
import { FORM_ERROR } from '@/ui/classes';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Pill } from '@/ui/Pill';

/* Accessibility shows up in a running helper, so while one is missing the row asks again this often. */
const POLL_MS = 2_000;

/* Asks quietly: a failed recheck changes nothing on screen, and the next one or the person's own press tries again. */
const recheckOn = (endpointId: string, how: 'restart' | 'status'): void => {
    transportFor(endpointId)
        ?.request(how === 'restart' ? 'computer.restart' : 'computer.status', {})
        .then((next) => useComputer.getState().setStatus(endpointId, next))
        .catch(() => undefined);
};

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

const PHASE_DOTS: Record<ComputerSetup['phase'], string> = {
    unknown: 'bg-text-faint',
    unsupported: 'bg-text-faint',
    unavailable: 'bg-text-faint',
    off: 'bg-text-faint',
    starting: 'bg-status-needs-you',
    grants: 'bg-status-needs-you',
    ready: 'bg-status-idle'
};

/* Where the machine stands, behind a dot in the color of what it asks of you. */
function SetupLine({ setup }: { setup: ComputerSetup }) {
    return (
        <span className="flex items-start gap-2">
            <span className="flex h-5 shrink-0 items-center">
                <span className={clsx('h-2 w-2 rounded-full', PHASE_DOTS[setup.phase])} />
            </span>
            {setupLine(setup)}
        </span>
    );
}

function ComputerMachine({ endpoint, first }: { endpoint: Endpoint; first: boolean }) {
    const { t } = useTranslation('settings');
    const connection = useEndpointConnection(endpoint.id);
    const connected = connection.status === 'open';
    const platform = useServers((s) => s.byEndpoint[endpoint.id]?.platform ?? null);
    const status = useComputer((s) => s.statuses[endpoint.id] ?? null);
    const grants = useComputer((s) => s.grants[endpoint.id] ?? null);
    const setup = computerSetupOf(status, platform);
    const bridge = desktop();
    const local = opensSystemSettings(endpoint.id, platform, bridge?.openSystemSettings !== undefined);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const recheck = connected ? recheckOf(setup) : null;

    useEffect(() => {
        if (recheck === null) {
            return;
        }
        const timer = window.setInterval(() => recheckOn(endpoint.id, 'status'), POLL_MS);
        return () => window.clearInterval(timer);
    }, [recheck, endpoint.id]);

    useEffect(() => {
        if (recheck === null || !local) {
            return;
        }
        // Coming back from System Settings is the moment a grant may have changed.
        const onFocus = (): void => recheckOn(endpoint.id, recheck);
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [recheck, local, endpoint.id]);

    async function attempt(work: (link: Transport) => Promise<void>): Promise<void> {
        const link = transportFor(endpoint.id);
        if (!link) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await work(link);
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure));
        } finally {
            setBusy(false);
        }
    }

    function run(work: (link: Transport) => Promise<ComputerUseStatus>): Promise<void> {
        return attempt(async (link) => useComputer.getState().setStatus(endpoint.id, await work(link)));
    }

    function revoke(payload: ComputerRevokePayload): Promise<void> {
        // The list itself comes back as `computer.grants`, to this window and every other.
        return attempt(async (link) => {
            await link.request('computer.revoke', payload);
        });
    }

    async function openGrant(grant: ComputerGrant): Promise<void> {
        // Asking first is what lists the helper in that pane, so the person finds a switch there instead of a + button.
        await run((link) => link.request('computer.requestGrant', { grant }));
        await bridge?.openSystemSettings?.(SYSTEM_SETTINGS_PANES[grant]);
    }

    return (
        <>
            <SettingsSection>
                <SettingsRow
                    searchId={first ? 'computer.enable' : undefined}
                    label={t('computer.enable', { machine: endpoint.label })}
                    description={connected ? <SetupLine setup={setup} /> : t('computer.machine.notConnected')}
                    control={
                        <Toggle
                            checked={status?.enabled === true}
                            label={t('computer.enable', { machine: endpoint.label })}
                            disabled={!connected || busy || !canSwitch(setup)}
                            onChange={(enabled) => void run((link) => link.request('computer.setEnabled', { enabled, language: activeLanguage() }))}
                        />
                    }
                >
                    {(error ?? status?.problem) && (
                        <p role="alert" className={FORM_ERROR}>
                            {error ?? status?.problem}
                        </p>
                    )}
                </SettingsRow>
            </SettingsSection>
            {connected && showsGrants(setup) && (
                <GrantSection
                    setup={setup}
                    local={local}
                    busy={busy}
                    machine={endpoint.label}
                    first={first}
                    onOpen={(grant) => void openGrant(grant)}
                    onCheck={() => void run((link) => link.request('computer.restart', {}))}
                />
            )}
            {connected && status?.enabled === true && grants !== null && (
                <ComputerAppGrants grants={grants} busy={busy} onRevoke={(payload) => void revoke(payload)} />
            )}
        </>
    );
}

const GRANT_TONES = { granted: 'idle', missing: 'needsYou', unknown: 'muted' } as const;

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
            {COMPUTER_GRANTS.map((grant) => {
                const state: GrantState = setup[grant];
                return (
                    <SettingsRow
                        key={grant}
                        searchId={first ? `computer.grant.${grant}` : undefined}
                        label={t(`computer.grant.${grant}.label`)}
                        description={t(`computer.grant.${grant}.description`)}
                        control={
                            <>
                                <Pill shape="tag" tone={GRANT_TONES[state]}>
                                    {t(`computer.state.${state}`)}
                                </Pill>
                                {local && state === 'missing' && (
                                    <Button variant="secondary" disabled={busy} onClick={() => onOpen(grant)}>
                                        {t('computer.open')}
                                    </Button>
                                )}
                            </>
                        }
                    />
                );
            })}
        </SettingsSection>
    );
}
