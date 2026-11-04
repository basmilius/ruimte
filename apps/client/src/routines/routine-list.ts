import type { RoutineListResult } from '@ruimte/contracts';
import { useEffect } from 'react';
import { create } from 'zustand';
import { machineTransport, pool } from '@/transport';
import { machineAnswers, useMachineAnswers } from '@/transport/features';
import { startMachineWatch } from '@/transport/machine-watch';

/*
 * Every routine on a machine, as the toolbar's dot and the stage ask for it. One `routine.watch` per
 * machine serves both, held while either is on screen; a `routine.changed` reads the list again whole,
 * since a list of all projects is what both show.
 */

type RoutineListRow = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; result: RoutineListResult };

export const useRoutineLists = create<{ lists: Readonly<Record<string, RoutineListRow>> }>(() => ({ lists: {} }));

interface MachineHold {
    users: number;
    generation: number;
    stop(): void;
}

const holds = new Map<string, MachineHold>();

function setRow(endpointId: string, row: RoutineListRow): void {
    useRoutineLists.setState((state) => ({ lists: { ...state.lists, [endpointId]: row } }));
}

/* Reads the list again now, as after a save, rather than waiting for the machine's word on it. */
export function refreshRoutines(endpointId: string): void {
    const hold = holds.get(endpointId);
    if (hold === undefined || !machineAnswers(pool.statusOf(endpointId), 'routine.list')) {
        return;
    }
    const generation = ++hold.generation;
    machineTransport(endpointId)
        .request('routine.list', {})
        .then((result) => {
            if (holds.get(endpointId)?.generation === generation) {
                setRow(endpointId, { status: 'ready', result });
            }
        })
        .catch(() => {
            if (holds.get(endpointId)?.generation === generation) {
                const current = useRoutineLists.getState().lists[endpointId];
                // A list that was there stays while the link is down; the next open reads it again.
                setRow(endpointId, current?.status === 'ready' ? current : { status: 'failed' });
            }
        });
}

function startHold(endpointId: string): MachineHold {
    const stop = startMachineWatch(endpointId, {
        watch: 'routine.watch',
        unwatch: 'routine.unwatch',
        refresh: () => refreshRoutines(endpointId),
        listen: (transport) => [transport.on('routine.changed', () => refreshRoutines(endpointId))]
    });

    return { users: 0, generation: 0, stop };
}

function holdRoutines(endpointId: string): () => void {
    let hold = holds.get(endpointId);
    if (hold === undefined) {
        hold = startHold(endpointId);
        holds.set(endpointId, hold);
        if (useRoutineLists.getState().lists[endpointId]?.status !== 'ready') {
            setRow(endpointId, { status: 'loading' });
        }
        refreshRoutines(endpointId);
    }
    hold.users += 1;
    let released = false;
    return () => {
        if (released) {
            return;
        }
        released = true;
        const current = holds.get(endpointId);
        if (current === undefined) {
            return;
        }
        current.users -= 1;
        if (current.users === 0) {
            current.stop();
            holds.delete(endpointId);
        }
    };
}

/* The machine's routines while the caller is on screen; null on a machine that has none to give. */
export function useRoutineList(endpointId: string): RoutineListRow | null {
    const answers = useMachineAnswers(endpointId, 'routine.list');
    const row = useRoutineLists((state) => state.lists[endpointId]);
    useEffect(() => {
        if (!answers) {
            return;
        }
        return holdRoutines(endpointId);
    }, [endpointId, answers]);
    if (!answers) {
        return null;
    }
    return row ?? { status: 'loading' };
}
