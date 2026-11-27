import { COARSE_POINTS, FINE_POINTS, type ProcessAlert, type ProcessPoint, type ProcessesSampleEvent, type ProcessesSubscribeResult } from '@ruimte/contracts';
import { create } from 'zustand';

interface ProcessesRow {
    /* Null until the machine answered the subscription; false on a platform without a sampler. */
    supported: boolean | null;
    fine: ProcessPoint[];
    coarse: ProcessPoint[];
    sample: ProcessesSampleEvent | null;
}

export const EMPTY_PROCESSES: ProcessesRow = { supported: null, fine: [], coarse: [], sample: null };

function capped(points: readonly ProcessPoint[], point: ProcessPoint | null, cap: number): ProcessPoint[] {
    return point === null ? [...points] : [...points, point].slice(-cap);
}

interface ProcessesStore {
    byEndpoint: Record<string, ProcessesRow>;
    receive(endpointId: string, result: ProcessesSubscribeResult): void;
    /* `current` is false for a sample of a scope the panel does not list. Its points count, its rows do not. */
    applySample(endpointId: string, sample: ProcessesSampleEvent, current: boolean): void;
    forget(endpointId: string): void;
}

export const useProcesses = create<ProcessesStore>((set, get) => {
    const patch = (endpointId: string, next: (row: ProcessesRow) => Partial<ProcessesRow>): void => {
        const row = get().byEndpoint[endpointId] ?? EMPTY_PROCESSES;
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: { ...row, ...next(row) } } });
    };
    return {
        byEndpoint: {},
        receive(endpointId, { supported, fine, coarse, sample }) {
            patch(endpointId, () => ({ supported, fine, coarse, sample }));
        },
        applySample(endpointId, sample, current) {
            patch(endpointId, (row) => ({
                sample: current ? sample : row.sample,
                // A sleep started the series over on the daemon; what is here is from before it.
                fine: capped(sample.reset ? [] : row.fine, sample.fine, FINE_POINTS),
                coarse: capped(sample.reset ? [] : row.coarse, sample.coarse, COARSE_POINTS)
            }));
        },
        forget(endpointId) {
            const { [endpointId]: _gone, ...rest } = get().byEndpoint;
            set({ byEndpoint: rest });
        }
    };
});

interface WarningsStore {
    byEndpoint: Record<string, ProcessAlert[]>;
    setAlerts(endpointId: string, alerts: ProcessAlert[]): void;
    forget(endpointId: string): void;
}

/*
 * The warnings apart from the samples. They reach every client, panel open or not, and the sidebar
 * and the nodes that draw them should not redraw on every sample of a panel somewhere.
 */
export const useProcessWarnings = create<WarningsStore>((set, get) => ({
    byEndpoint: {},
    setAlerts(endpointId, alerts) {
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: alerts } });
    },
    forget(endpointId) {
        const { [endpointId]: _gone, ...rest } = get().byEndpoint;
        set({ byEndpoint: rest });
    }
}));

const NO_ALERTS: ProcessAlert[] = [];

/* The warnings of one machine, as a stable array while there are none. */
export function useProcessAlerts(endpointId: string): ProcessAlert[] {
    return useProcessWarnings((s) => s.byEndpoint[endpointId] ?? NO_ALERTS);
}
