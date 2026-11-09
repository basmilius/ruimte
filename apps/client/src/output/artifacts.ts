import type { ArtifactListPayload, ArtifactSummary } from '@ruimte/contracts';
import { useEffect } from 'react';
import { create } from 'zustand';
import { endpointKey } from '@/state/keys';
import { machineTransport, pool } from '@/transport';
import type { Transport } from '@/transport-api/transport';
import { machineAnswers } from '@/transport/features';
import { startMachineWatch } from '@/transport/machine-watch';

/*
 * What a machine keeps in Output, as the surfaces on screen asked for it: the panel the whole list, a
 * chat what it made. One `artifact.watch` per machine serves them all, held while any of them is on
 * screen, and every change it reports reads each list again and bumps the artifact's revision, which
 * an open artifact view reads again on.
 */

interface ArtifactListRow {
    status: 'loading' | 'ready' | 'failed';
    artifacts: ArtifactSummary[];
}

interface ArtifactsStore {
    /* By `endpointKey(endpointId, queryKey)`. */
    lists: Readonly<Record<string, ArtifactListRow>>;
    /* By `endpointKey(endpointId, artifactId)`: how often the machine said the artifact changed. */
    revisions: Readonly<Record<string, number>>;
}

export const useArtifacts = create<ArtifactsStore>(() => ({ lists: {}, revisions: {} }));

interface MachineWatch {
    users: number;
    queries: Map<string, { payload: ArtifactListPayload; users: number; generation: number }>;
    stop(): void;
}

const watches = new Map<string, MachineWatch>();

function queryKeyOf(payload: ArtifactListPayload): string {
    return `list:${payload.projectId ?? ''}:${payload.chatId ?? ''}`;
}

function setList(key: string, row: ArtifactListRow): void {
    useArtifacts.setState((state) => ({ lists: { ...state.lists, [key]: row } }));
}

function refreshQuery(endpointId: string, transport: Transport, queryKey: string): void {
    const query = watches.get(endpointId)?.queries.get(queryKey);
    if (query === undefined || !machineAnswers(pool.statusOf(endpointId), 'artifact.list')) {
        return;
    }
    const generation = ++query.generation;
    const key = endpointKey(endpointId, queryKey);
    transport
        .request('artifact.list', query.payload)
        .then(({ artifacts }) => {
            if (watches.get(endpointId)?.queries.get(queryKey)?.generation === generation) {
                setList(key, { status: 'ready', artifacts });
            }
        })
        .catch(() => {
            if (watches.get(endpointId)?.queries.get(queryKey)?.generation === generation) {
                const current = useArtifacts.getState().lists[key];
                // A list that was there stays while the link is down; the next open reads it again.
                setList(key, current?.status === 'ready' ? current : { status: 'failed', artifacts: [] });
            }
        });
}

function startWatch(endpointId: string): MachineWatch {
    const queries: MachineWatch['queries'] = new Map();
    const refreshAll = (): void => {
        const transport = machineTransport(endpointId);

        for (const queryKey of queries.keys()) {
            refreshQuery(endpointId, transport, queryKey);
        }
    };
    const stop = startMachineWatch(endpointId, {
        watch: 'artifact.watch',
        unwatch: 'artifact.unwatch',
        refresh: refreshAll,
        listen: (transport) => [
            transport.on('artifact.changed', ({ artifactId }) => {
                const key = endpointKey(endpointId, artifactId);
                useArtifacts.setState((state) => ({ revisions: { ...state.revisions, [key]: (state.revisions[key] ?? 0) + 1 } }));
                refreshAll();
            })
        ]
    });

    return { users: 0, queries, stop };
}

export function holdArtifacts(endpointId: string, payload: ArtifactListPayload | null): () => void {
    let machine = watches.get(endpointId);
    if (machine === undefined) {
        machine = startWatch(endpointId);
        watches.set(endpointId, machine);
    }
    machine.users += 1;
    const queryKey = payload === null ? null : queryKeyOf(payload);
    if (payload !== null && queryKey !== null) {
        const query = machine.queries.get(queryKey) ?? { payload, users: 0, generation: 0 };
        query.users += 1;
        machine.queries.set(queryKey, query);
        if (query.users === 1) {
            refreshQuery(endpointId, machineTransport(endpointId), queryKey);
        }
    }
    let released = false;
    return () => {
        if (released) {
            return;
        }
        released = true;
        const current = watches.get(endpointId);
        if (current === undefined) {
            return;
        }
        if (queryKey !== null) {
            const query = current.queries.get(queryKey);
            if (query !== undefined && --query.users <= 0) {
                current.queries.delete(queryKey);
            }
        }
        if (--current.users <= 0) {
            current.stop();
            watches.delete(endpointId);
        }
    };
}

export function useArtifactList(endpointId: string, payload: ArtifactListPayload, answers: boolean): ArtifactListRow | null {
    const queryKey = queryKeyOf(payload);
    const key = endpointKey(endpointId, queryKey);
    const projectId = payload.projectId;
    const chatId = payload.chatId;
    useEffect(() => {
        if (!answers) {
            return;
        }
        return holdArtifacts(endpointId, { ...(projectId === undefined ? {} : { projectId }), ...(chatId === undefined ? {} : { chatId }) });
    }, [endpointId, projectId, chatId, answers]);
    const row = useArtifacts((state) => state.lists[key]);
    if (!answers) {
        return null;
    }
    return row ?? LOADING;
}

const LOADING: ArtifactListRow = { status: 'loading', artifacts: [] };

export function useArtifactRevision(endpointId: string, artifactId: string): number {
    return useArtifacts((state) => state.revisions[endpointKey(endpointId, artifactId)] ?? 0);
}

/* A fresh id for a save, so a retry of the same click lands once. */
export function newRequestId(): string {
    return crypto.randomUUID().replaceAll('-', '');
}
