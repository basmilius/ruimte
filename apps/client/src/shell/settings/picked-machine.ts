import { create } from 'zustand';
import { useListedMachines } from '@/shell/settings/machine-list';
import type { Endpoint } from '@/state/endpoints';
import { useEndpointId } from '@/state/keys';

interface PickedMachineState {
    /* The endpoint a person picked in a section's tag, or null for the machine this window works on. */
    id: string | null;
    pick(id: string): void;
}

/* One pick for every section that holds the settings of one machine, so a pane never shows two machines at once. */
export const usePickedMachineState = create<PickedMachineState>((set) => ({
    id: null,
    pick: (id) => set({ id })
}));

/* The machine the per-machine sections show: the one picked, else the one this window works on, else the first listed. */
export function usePickedMachine(): Endpoint | null {
    const listed = useListedMachines();
    const picked = usePickedMachineState((s) => s.id);
    const focused = useEndpointId();

    return listed.find((endpoint) => endpoint.id === picked) ?? listed.find((endpoint) => endpoint.id === focused) ?? listed[0] ?? null;
}
