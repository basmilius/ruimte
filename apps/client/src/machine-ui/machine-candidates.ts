import { messageOf } from '@adecore/ui';
import type { MachineCandidate } from '@ruimte/contracts';
import { useEffect, useState } from 'react';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { useProject } from '@/state/project';
import { transportFor } from '@/transport';
import { orNull } from '@/transport-api/transport';
import { useMachineAnswers } from '@/transport/features';
import { useEndpointConnection } from '@/transport/status';
import { refreshAccountMachines } from '@/workspace/account-machines';

/* Which place of which source, as the row and the detail name it. */
export function candidateKey(candidate: MachineCandidate): string {
    return [candidate.source.extension, candidate.source.id, candidate.id].join('\n');
}

const UNDER_WAY: readonly MachineCandidate['state'][] = ['preparing', 'starting', 'joining'];

export function underWay(candidate: MachineCandidate): boolean {
    return UNDER_WAY.includes(candidate.state);
}

/* The page a new machine's sign-in names in what it wrote, for a link beside its lines. */
export function signInPageOf(lines: readonly string[]): string | null {
    for (const line of lines.toReversed()) {
        const page = /https:\/\/[^\s"'<>]+/.exec(line)?.[0];

        if (page !== undefined) {
            return page;
        }
    }

    return null;
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

interface CandidateActions {
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
