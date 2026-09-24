import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { CircleCheck, CircleDashed, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ComputerGrant, ComputerUseStatus } from '@ruimte/contracts';
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
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { activeLanguage } from '@/i18n/active';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Toggle } from '@/shell/settings/controls';
import { useComputer } from '@/state/computer';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { listedEndpoints } from '@/state/local-machine';
import { useServers } from '@/state/server';
import { transportFor } from '@/transport';
import { useEndpointConnection } from '@/transport/status';
import type { Transport } from '@/transport/transport';
import { Button } from '@/ui/Button';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Icon } from '@/ui/Icon';
import { Pill } from '@/ui/Pill';

/* Accessibility shows up in a running helper, so while one is missing the row asks again this often. */
const POLL_MS = 2_000;

const GRANT_ICONS = { granted: CircleCheck, missing: CircleDashed, unknown: LoaderCircle } as const;

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

/* One row per machine, like every setting an agent is held to: the machine enforces it, so each keeps its own. */
function ComputerSection() {
    const { t } = useTranslation('settings');
    const stored = useEndpoints((s) => s.endpoints);
    const endpoints = useMemo(() => listedEndpoints(stored), [stored]);
    const ordered = [
        ...endpoints.filter((endpoint) => endpoint.id === LOCAL_ENDPOINT_ID),
        ...endpoints.filter((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID)
    ];
    return (
        <SettingsSection title={t('computer.title')} description={t('computer.description')}>
            {ordered.map((endpoint) => (
                <ComputerMachineRow key={endpoint.id} endpoint={endpoint} />
            ))}
        </SettingsSection>
    );
}

function ComputerMachineRow({ endpoint }: { endpoint: Endpoint }) {
    const { t } = useTranslation('settings');
    const connection = useEndpointConnection(endpoint.id);
    const connected = connection.status === 'open';
    const platform = useServers((s) => s.byEndpoint[endpoint.id]?.platform ?? null);
    const icon = useServers((s) => s.byEndpoint[endpoint.id]?.icon ?? null);
    const status = useComputer((s) => s.statuses[endpoint.id] ?? null);
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

    async function run(work: (link: Transport) => Promise<ComputerUseStatus>): Promise<void> {
        const link = transportFor(endpoint.id);
        if (!link) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            useComputer.getState().setStatus(endpoint.id, await work(link));
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure));
        } finally {
            setBusy(false);
        }
    }

    async function openGrant(grant: ComputerGrant): Promise<void> {
        // Asking first is what lists the helper in that pane, so the person finds a switch there instead of a + button.
        await run((link) => link.request('computer.requestGrant', { grant }));
        await bridge?.openSystemSettings?.(SYSTEM_SETTINGS_PANES[grant]);
    }

    return (
        <SettingsRow
            label={
                <span className="flex items-center gap-2">
                    <MachineGlyph icon={icon} className="shrink-0 text-text-muted" />
                    <span className="truncate">{endpoint.label}</span>
                </span>
            }
            description={connected ? setupLine(setup) : t('computer.machine.notConnected')}
            control={
                <Toggle
                    checked={status?.enabled === true}
                    label={t('computer.enable', { machine: endpoint.label })}
                    disabled={!connected || busy || !canSwitch(setup)}
                    onChange={(enabled) => void run((link) => link.request('computer.setEnabled', { enabled, language: activeLanguage() }))}
                />
            }
        >
            {connected && showsGrants(setup) && (
                <GrantList
                    setup={setup}
                    local={local}
                    busy={busy}
                    machine={endpoint.label}
                    onOpen={(grant) => void openGrant(grant)}
                    onCheck={() => void run((link) => link.request('computer.restart', {}))}
                />
            )}
            {(error ?? status?.problem) && (
                <p role="alert" className="text-xs text-status-error">
                    {error ?? status?.problem}
                </p>
            )}
        </SettingsRow>
    );
}

interface GrantListProps {
    setup: ComputerSetup;
    // This Mac, whose System Settings the shell can open.
    local: boolean;
    busy: boolean;
    machine: string;
    onOpen(grant: ComputerGrant): void;
    onCheck(): void;
}

function GrantList({ setup, local, busy, machine, onOpen, onCheck }: GrantListProps) {
    const { t } = useTranslation('settings');
    const stateOf = (grant: ComputerGrant): GrantState => setup[grant];
    return (
        <div className="flex min-w-0 flex-col gap-2">
            <ul className="flex min-w-0 flex-col gap-2">
                {COMPUTER_GRANTS.map((grant) => {
                    const state = stateOf(grant);
                    return (
                        <li key={grant} className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg bg-surface-raised px-3 py-2.5">
                            <Icon
                                icon={GRANT_ICONS[state]}
                                size={16}
                                className={clsx('shrink-0', state === 'granted' ? 'text-accent' : 'text-text-muted', state === 'unknown' && 'animate-spin')}
                            />
                            <div className="min-w-0 grow basis-40">
                                <div className="text-sm text-text">{t(`computer.grant.${grant}.label`)}</div>
                                <div className="text-xs text-text-muted">{t(`computer.grant.${grant}.description`)}</div>
                            </div>
                            <Pill shape="tag" tone={state === 'granted' ? 'accent' : 'muted'}>
                                {t(`computer.state.${state}`)}
                            </Pill>
                            {local && state === 'missing' && (
                                <Button variant="secondary" size="sm" disabled={busy} onClick={() => onOpen(grant)}>
                                    {t('computer.open')}
                                </Button>
                            )}
                        </li>
                    );
                })}
            </ul>
            {!local && setup.phase !== 'ready' && <p className="text-xs text-text-muted">{t('computer.remote', { machine })}</p>}
            {setup.screenRecording === 'missing' && (
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-3">
                    {local && <p className="min-w-0 grow basis-60 text-xs text-text-muted">{t('computer.restartNote')}</p>}
                    <Button variant="secondary" size="sm" disabled={busy} onClick={onCheck}>
                        {t('computer.checkAgain')}
                    </Button>
                </div>
            )}
        </div>
    );
}
