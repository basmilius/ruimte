import { useEffect, useState } from 'react';
import type { ComputerAppGrants, ComputerGrant, ComputerRevokePayload, ComputerUseStatus } from '@ruimte/contracts';
import { computerSetupOf, opensSystemSettings, recheckOf, SYSTEM_SETTINGS_PANES, type ComputerSetup } from '@/computer/setup';
import { desktop } from '@/desktop/bridge';
import { activeLanguage } from '@/i18n/active';
import { useComputer } from '@/state/computer';
import { useServers } from '@/state/server';
import { transportFor } from '@/transport';
import { useEndpointConnection } from '@/transport/status';
import type { Transport } from '@/transport/transport';

/* Accessibility shows up in a running helper, so while one is missing the machine is asked again this often. */
const POLL_MS = 2_000;

/* Asks quietly: a failed recheck changes nothing on screen, and the next one or the person's own press tries again. */
function recheckOn(endpointId: string, how: 'restart' | 'status'): void {
    transportFor(endpointId)
        ?.request(how === 'restart' ? 'computer.restart' : 'computer.status', {})
        .then((next) => useComputer.getState().setStatus(endpointId, next))
        .catch(() => undefined);
}

export interface ComputerMachine {
    connected: boolean;
    status: ComputerUseStatus | null;
    grants: ComputerAppGrants | null;
    setup: ComputerSetup;
    /* This Mac, whose System Settings the shell can open. */
    local: boolean;
    busy: boolean;
    /* What the last step that failed said; the machine's own `problem` stands beside it. */
    error: string | null;
    setEnabled(enabled: boolean): void;
    /* Asks the helper for the grant first, which lists it in that pane of System Settings, then opens the pane. */
    openGrant(grant: ComputerGrant): void;
    /* Starts the helper again, which is the only way it sees a Screen Recording grant. */
    checkAgain(): void;
    revoke(payload: ComputerRevokePayload): void;
}

/*
 * Computer use on one machine, for whatever shows its switch and its grants. While a grant is missing
 * it asks the machine again on a clock, and once more when the window comes back from System Settings.
 */
export function useComputerMachine(endpointId: string): ComputerMachine {
    const connection = useEndpointConnection(endpointId);
    const connected = connection.status === 'open';
    const platform = useServers((s) => s.byEndpoint[endpointId]?.platform ?? null);
    const status = useComputer((s) => s.statuses[endpointId] ?? null);
    const grants = useComputer((s) => s.grants[endpointId] ?? null);
    const setup = computerSetupOf(status, platform);
    const bridge = desktop();
    const local = opensSystemSettings(endpointId, platform, bridge?.openSystemSettings !== undefined);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const recheck = connected ? recheckOf(setup) : null;

    useEffect(() => {
        if (recheck === null) {
            return;
        }
        const timer = window.setInterval(() => recheckOn(endpointId, 'status'), POLL_MS);
        return () => window.clearInterval(timer);
    }, [recheck, endpointId]);

    useEffect(() => {
        if (recheck === null || !local) {
            return;
        }
        // Coming back from System Settings is the moment a grant may have changed.
        const onFocus = (): void => recheckOn(endpointId, recheck);
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [recheck, local, endpointId]);

    const attempt = async (work: (link: Transport) => Promise<void>): Promise<void> => {
        const link = transportFor(endpointId);
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
    };

    const run = (work: (link: Transport) => Promise<ComputerUseStatus>): Promise<void> =>
        attempt(async (link) => useComputer.getState().setStatus(endpointId, await work(link)));

    const openGrant = async (grant: ComputerGrant): Promise<void> => {
        await run((link) => link.request('computer.requestGrant', { grant }));
        await bridge?.openSystemSettings?.(SYSTEM_SETTINGS_PANES[grant]);
    };

    return {
        connected,
        status,
        grants,
        setup,
        local,
        busy,
        error,
        setEnabled: (enabled) => void run((link) => link.request('computer.setEnabled', { enabled, language: activeLanguage() })),
        openGrant: (grant) => void openGrant(grant),
        checkAgain: () => void run((link) => link.request('computer.restart', {})),
        // The list itself comes back as `computer.grants`, to this window and every other.
        revoke: (payload) =>
            void attempt(async (link) => {
                await link.request('computer.revoke', payload);
            })
    };
}
