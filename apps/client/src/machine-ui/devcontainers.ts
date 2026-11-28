import { messageOf } from '@adecore/ui';
import type { DevcontainerBridge, DevcontainerStart } from '@ruimte/desktop-bridge';
import { RegisterMachinePayloadSchema } from '@ruimte/pulsar';
import i18next from 'i18next';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { desktop, machineMode } from '@/desktop/bridge';
import type { CandidateActions, CandidateJoin } from '@/machine-ui/machine-candidates';
import { openFolderOn } from '@/project/open';
import { usePulsarAccount, withAccessToken } from '@/pulsar/account';
import { usePulsarMachines } from '@/state/pulsar-machines';
import { useUi } from '@/state/ui';
import { openAccountMachine, refreshAccountMachines, withRefusalText } from '@/workspace/account-machines';

interface DevcontainerStore {
    starts: DevcontainerStart[];
    /* The start the Machines pane shows, set when a person picked a folder; `turn` brings the same one back. */
    focused: { id: string; turn: number } | null;
    /* Why the last pick did not get as far as a start. */
    failure: string | null;
}

export const useDevcontainers = create<DevcontainerStore>(() => ({ starts: [], focused: null, failure: null }));

/* Only an app that runs no machine of its own starts one in a dev container itself; it does so through its shell. */
export function devcontainerBridge(): DevcontainerBridge | null {
    return machineMode() === 'none' ? (desktop()?.devcontainers ?? null) : null;
}

export function offersDevcontainers(): boolean {
    return devcontainerBridge() !== null;
}

function keep(start: DevcontainerStart): void {
    useDevcontainers.setState((before) => ({
        starts: before.starts.some((each) => each.id === start.id)
            ? before.starts.map((each) => (each.id === start.id ? start : each))
            : [...before.starts, start]
    }));
}

/* Follows what the shell says of its starts while a surface that lists them is up. */
export function useWatchDevcontainers(): void {
    useEffect(() => {
        const bridge = devcontainerBridge();

        if (bridge === null) {
            return;
        }

        let alive = true;
        const off = bridge.onChanged(keep);

        void bridge.list().then(
            (starts) => {
                if (alive) {
                    useDevcontainers.setState({ starts });
                }
            },
            (e: unknown) => useDevcontainers.setState({ failure: messageOf(e) })
        );

        return () => {
            alive = false;
            off();
        };
    }, []);
}

/*
 * The shell shows a folder picker and reads what the picked folder would run, for the account this app is signed in
 * to. The Machines pane then shows it, held for the person's yes. False when nothing was picked.
 */
export async function pickDevcontainerFolder(): Promise<boolean> {
    const bridge = devcontainerBridge();
    const account = usePulsarAccount.getState().account;

    useDevcontainers.setState({ failure: null });

    if (bridge === null || account === null) {
        useDevcontainers.setState({ failure: i18next.t('settings:machines.devcontainer.signedOut') });

        return false;
    }

    try {
        const start = await bridge.pick(account.id);

        if (start === null) {
            return false;
        }

        keep(start);
        useDevcontainers.setState((before) => ({ focused: { id: start.id, turn: (before.focused?.turn ?? 0) + 1 } }));

        return true;
    } catch (e) {
        useDevcontainers.setState({ failure: messageOf(e) });

        return false;
    }
}

/* Opens the project folder on the new machine in this window, once the account lists that machine. */
export async function openDevcontainerFolder(start: DevcontainerStart): Promise<void> {
    if (start.machineId === null || start.workspaceFolder === null) {
        return;
    }

    await refreshAccountMachines();

    const machine = usePulsarMachines.getState().machines?.find((each) => each.id === start.machineId);

    if (machine === undefined) {
        throw new Error(i18next.t('settings:machines.sources.done.description'));
    }

    const endpoint = openAccountMachine(machine);

    useUi.getState().setSettings({ open: false });
    await openFolderOn(endpoint.id, start.workspaceFolder);
}

export function useDevcontainerActions(start: DevcontainerStart): CandidateActions {
    const [failure, setFailure] = useState<string | null>(null);
    const accountId = usePulsarAccount((s) => s.account?.id ?? null);

    return {
        failure,
        start(approve) {
            const bridge = devcontainerBridge();

            setFailure(null);

            if (bridge === null || accountId === null) {
                setFailure(i18next.t('settings:machines.devcontainer.signedOut'));

                return;
            }

            // Without a yes the shell reads the folder again and shows what it would run.
            bridge.start(start.id, accountId, approve ?? '').then(keep, (e: unknown) => setFailure(messageOf(e)));
        },
        stop() {
            setFailure(null);
            devcontainerBridge()
                ?.stop(start.id)
                .catch((e: unknown) => setFailure(messageOf(e)));
        }
    };
}

// The joins under way, so two surfaces that show the same start post one registration.
const joins = new Map<string, Promise<void>>();

async function postDevcontainer(id: string, accountId: string): Promise<void> {
    const bridge = devcontainerBridge();

    if (bridge === null) {
        return;
    }

    const registration = RegisterMachinePayloadSchema.parse(await bridge.registration(id, accountId));

    await withRefusalText(() => withAccessToken((client, token) => client.registerMachine(token, registration)));
    await bridge.joined(id);

    const start = useDevcontainers.getState().starts.find((each) => each.id === id);

    if (start !== undefined) {
        await openDevcontainerFolder(start);
    }
}

/*
 * Posts what the new machine signed with this app's session, as the app does for a machine an extension started, and
 * then opens the project folder on it. The shell only hands the registration over.
 */
export function useDevcontainerJoin(start: DevcontainerStart): CandidateJoin {
    const accountId = usePulsarAccount((s) => s.account?.id ?? null);
    const [failure, setFailure] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const signed = start.candidate.state === 'joining' && start.candidate.join === 'signed';
    const { id } = start;

    useEffect(() => {
        if (!signed || accountId === null) {
            return;
        }

        let alive = true;
        const join = joins.get(id) ?? postDevcontainer(id, accountId).finally(() => joins.delete(id));

        joins.set(id, join);
        join.catch((e: unknown) => {
            if (alive) {
                setFailure(messageOf(e));
            }
        });

        return () => {
            alive = false;
        };
    }, [signed, accountId, attempt, id]);

    return {
        needsSignIn: signed && accountId === null,
        failure: signed ? failure : null,
        retry() {
            setFailure(null);
            setAttempt((before) => before + 1);
        }
    };
}
