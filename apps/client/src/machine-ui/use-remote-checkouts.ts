import { messageOf } from '@adecore/ui';
import type { DeviceInfo, GitIdentity, GitIdentityResult, RemoteLink } from '@ruimte/contracts';
import { useEffect, useState } from 'react';
import { rankCandidates, type RemoteCandidate } from '@/project/remote-candidates';
import { endpointById } from '@/state/endpoints';
import type { Transport } from '@/transport-api/transport';
import { machineAnswers } from '@/transport/features';
import { pool, transportFor } from '@/transport/index';
import { ensureMachine } from '@/workspace/reach';

/* What the dialog knows of the checkouts a machine could offer: still looking, not reachable, or the possibilities. */
export type Checkouts =
    | { state: 'loading' }
    | { state: 'error'; message: string }
    | { state: 'ready'; candidates: RemoteCandidate[]; links: RemoteLink[]; here: GitIdentity | null; linkedFolder: string | null };

/* What this project is, as far as the other machine can tell whether it holds the same repository. */
async function identityHere(transport: Transport, folder: string | null): Promise<GitIdentity | null> {
    if (folder === null || !machineAnswers(transport.connection, 'git.identity')) {
        return null;
    }
    const { identities } = await transport.request('git.identity', { paths: [folder] }).catch(() => ({ identities: [] }));
    return firstIdentity(identities);
}

/* The identity of the one path a request asked for, unless the machine could not read it. */
export function firstIdentity(identities: GitIdentityResult['identities']): GitIdentity | null {
    const identity = identities[0];
    return identity === undefined || 'error' in identity ? null : identity;
}

/*
 * The projects of another machine that could be this project's checkout there, the ones of the same
 * repository first. Looking at a machine is asking for it, so its link is brought up first and held
 * for as long as the dialog is open.
 */
export function useRemoteCheckouts(
    machineId: string,
    projectId: string | null,
    folder: string | null,
    here: Transport | null
): { checkouts: Checkouts; retry(): void } {
    const [checkouts, setCheckouts] = useState<Checkouts>({ state: 'loading' });
    const [attempt, setAttempt] = useState(0);
    const retry = (): void => {
        setCheckouts({ state: 'loading' });
        setAttempt((before) => before + 1);
    };

    useEffect(() => {
        if (here === null) {
            return;
        }
        const controller = new AbortController();
        let release: (() => void) | null = null;
        void (async () => {
            try {
                const endpointId = await ensureMachine(machineId, controller.signal);
                const endpoint = endpointById(endpointId);
                release = endpoint === null ? null : pool.hold(endpoint);
                const there = transportFor(endpointId);
                if (there === null) {
                    throw new Error('The machine is no longer known.');
                }
                const [mine, listed, links] = await Promise.all([
                    identityHere(here, folder),
                    there.request('project.list', {}),
                    projectId === null || !machineAnswers(here.connection, 'remote.list')
                        ? Promise.resolve({ links: [] })
                        : here.request('remote.list', { projectId }).catch(() => ({ links: [] }))
                ]);
                const projects = listed.projects.filter((project) => project.available).slice(0, 50);
                const { identities } =
                    projects.length === 0 || !machineAnswers(there.connection, 'git.identity')
                        ? { identities: [] }
                        : await there.request('git.identity', { paths: projects.map((project) => project.folder) });
                // The folder there of the project this one is linked to already, which linking again keeps the nodes in.
                const linked = links.links.find((link) => link.machineId === machineId);
                const linkedFolder = listed.projects.find((project) => project.projectId === linked?.remoteProjectId)?.folder ?? null;
                if (!controller.signal.aborted) {
                    setCheckouts({ state: 'ready', candidates: rankCandidates(mine, projects, identities), links: links.links, here: mine, linkedFolder });
                }
            } catch (e) {
                if (!controller.signal.aborted) {
                    setCheckouts({ state: 'error', message: messageOf(e) });
                }
            }
        })();
        return () => {
            controller.abort();
            release?.();
        };
    }, [machineId, projectId, folder, here, attempt]);

    return { checkouts, retry };
}

/* The simulators and phones a machine has, for a device node on it. */
export function useRemoteDevices(machineId: string, enabled: boolean): { devices: DeviceInfo[] | null; failed: boolean } {
    const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        if (!enabled) {
            return;
        }
        let current = true;
        void ensureMachine(machineId)
            .then((endpointId) => transportFor(endpointId)?.request('device.list', {}))
            .then((answer) => {
                if (current) {
                    setDevices(answer?.devices ?? []);
                    setFailed(answer === undefined);
                }
            })
            .catch(() => {
                if (current) {
                    setFailed(true);
                }
            });
        return () => {
            current = false;
        };
    }, [machineId, enabled]);
    return { devices, failed };
}

/* What this project's checkout holds, for the "Start from" choices: the branch, how many files changed and whether the branch has an upstream. */
export interface CheckoutState {
    branch: string | null;
    changed: number;
    upstream: boolean;
}

export function useCheckoutState(here: Transport | null, folder: string | null, enabled: boolean): CheckoutState | null {
    const [state, setState] = useState<CheckoutState | null>(null);
    useEffect(() => {
        if (!enabled || here === null || folder === null) {
            return;
        }
        let current = true;
        here.request('git.status', { cwd: folder })
            .then((status) => {
                if (current) {
                    setState(status.repo ? { branch: status.branch, changed: status.files.length, upstream: status.upstream !== null } : null);
                }
            })
            .catch(() => undefined);
        return () => {
            current = false;
        };
    }, [here, folder, enabled]);
    return state;
}
