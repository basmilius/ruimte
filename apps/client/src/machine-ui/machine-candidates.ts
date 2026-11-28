import { messageOf } from '@adecore/ui';
import type { MachineCandidate } from '@ruimte/contracts';
import { useEffect, useState } from 'react';
import { usePulsarAccount } from '@/pulsar/account';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { useProject } from '@/state/project';
import { transportFor } from '@/transport';
import { orNull } from '@/transport-api/transport';
import { useMachineAnswers } from '@/transport/features';
import { useEndpointConnection } from '@/transport/status';
import { joinStartedMachine, refreshAccountMachines } from '@/workspace/account-machines';

/* Which place of which source, as the row and the detail name it. */
export function candidateKey(candidate: MachineCandidate): string {
    return [candidate.source.extension, candidate.source.id, candidate.id].join('\n');
}

const UNDER_WAY: readonly MachineCandidate['state'][] = ['preparing', 'starting', 'joining'];

export function underWay(candidate: MachineCandidate): boolean {
    return UNDER_WAY.includes(candidate.state);
}

interface Listed {
    projectId: string;
    candidates: MachineCandidate[];
}

/*
 * The places the extensions of this computer's machine can start a machine in, for the project on screen. Only the app
 * on that computer asks: a start runs programs there, and its machine answers these requests to nobody else. A window
 * on another machine, and the web client, list none.
 */
export function useMachineCandidates(): { projectId: string | null; candidates: readonly MachineCandidate[] } {
    const projectId = useProject((s) => (s.currentEndpointId === LOCAL_ENDPOINT_ID ? (s.current?.projectId ?? null) : null));
    const answers = useMachineAnswers(LOCAL_ENDPOINT_ID, 'extension.machineList');
    const status = useEndpointConnection(LOCAL_ENDPOINT_ID).status;
    const [listed, setListed] = useState<Listed | null>(null);
    const asks = projectId !== null && answers && status === 'open';

    useEffect(() => {
        const link = asks ? transportFor(LOCAL_ENDPOINT_ID) : null;

        if (link === null || projectId === null) {
            return;
        }

        let alive = true;
        const off = link.on('extension.machineChanged', (event) => {
            if (event.projectId !== projectId) {
                return;
            }

            if (event.candidate.state === 'done') {
                // The new machine is on the account now, which only the account's own list says.
                void refreshAccountMachines();
            }

            setListed((before) => {
                const candidates = before?.projectId === projectId ? before.candidates : [];
                const key = candidateKey(event.candidate);
                const known = candidates.some((candidate) => candidateKey(candidate) === key);

                return {
                    projectId,
                    candidates: known
                        ? candidates.map((candidate) => (candidateKey(candidate) === key ? event.candidate : candidate))
                        : [...candidates, event.candidate]
                };
            });
        });

        void orNull('extension.machineList', link.request('extension.machineList', { projectId })).then((answer) => {
            if (alive && answer !== null) {
                setListed({ projectId, candidates: answer.candidates });
            }
        });

        return () => {
            alive = false;
            off();
        };
    }, [asks, projectId]);

    return { projectId, candidates: asks && listed?.projectId === projectId ? listed.candidates : [] };
}

export interface CandidateJoin {
    /* The new machine signed, and nobody is signed in here to post it. */
    needsSignIn: boolean;
    /* Why the account did not take it. */
    failure: string | null;
    retry(): void;
}

/*
 * Finishes what a start left for a client: the new machine signed itself onto the account, and a client signed in to it
 * posts that. Whoever looks at the place does, so a start whose window closed in between is finished by the next one.
 */
export function useCandidateJoin(projectId: string, candidate: MachineCandidate): CandidateJoin {
    const accountId = usePulsarAccount((s) => s.account?.id ?? null);
    const [failure, setFailure] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const signed = candidate.state === 'joining' && candidate.join === 'signed';
    const { extension, id: source } = candidate.source;
    const place = candidate.id;

    useEffect(() => {
        if (!signed || accountId === null) {
            return;
        }

        let alive = true;

        joinStartedMachine({ projectId, extension, source, candidate: place }).catch((e: unknown) => {
            if (alive) {
                setFailure(messageOf(e));
            }
        });

        return () => {
            alive = false;
        };
    }, [signed, accountId, attempt, projectId, extension, source, place]);

    return {
        needsSignIn: signed && accountId === null,
        failure: signed ? failure : null,
        retry() {
            setFailure(null);
            setAttempt((before) => before + 1);
        }
    };
}

export interface CandidateActions {
    failure: string | null;
    /* `approve` is the person's yes to what the start was held with. */
    start(approve?: string): void;
    stop(): void;
}

/* Starting and stopping one place, with the reason the machine gave when it would not. How the start goes arrives as events. */
export function useCandidateActions(projectId: string, candidate: MachineCandidate): CandidateActions {
    const [failure, setFailure] = useState<string | null>(null);
    const target = { projectId, extension: candidate.source.extension, source: candidate.source.id, candidate: candidate.id };

    return {
        failure,
        start(approve) {
            setFailure(null);
            transportFor(LOCAL_ENDPOINT_ID)
                ?.request('extension.machineStart', { ...target, ...(approve === undefined ? {} : { approve }) })
                .catch((e: unknown) => setFailure(messageOf(e)));
        },
        stop() {
            setFailure(null);
            transportFor(LOCAL_ENDPOINT_ID)
                ?.request('extension.machineStop', target)
                .catch((e: unknown) => setFailure(messageOf(e)));
        }
    };
}
