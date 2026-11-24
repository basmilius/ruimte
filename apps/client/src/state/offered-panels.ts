import { create } from 'zustand';

interface OfferedPanelsState {
    /* By panel kind. A kind nothing was said about is not offered. */
    offered: Readonly<Record<string, boolean>>;
}

/*
 * The panels the project on screen gets a rail button for only while their feature has something to show
 * (`onOffer` in `panel-traits.ts`). The feature says so from its own watch, so the rail asks no machine.
 */
export const useOfferedPanels = create<OfferedPanelsState>(() => ({ offered: {} }));

export function offerPanel(kind: string, offered: boolean): void {
    if ((useOfferedPanels.getState().offered[kind] ?? false) !== offered) {
        useOfferedPanels.setState((state) => ({ offered: { ...state.offered, [kind]: offered } }));
    }
}
