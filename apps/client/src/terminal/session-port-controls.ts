import { create } from 'zustand';
import type { SessionPort, SessionPortsResult } from '@ruimte/contracts';
import { endpointKey, useEndpointId } from '@/state/keys';

export interface SessionPortControls {
    result: SessionPortsResult;
    opening: boolean;
    localRoute: boolean;
    open(port: SessionPort): Promise<void>;
}

// The body owns polling; headers only display its controls, including when a view's toolbar folds.
export const useSessionPortControls = create<{ byKey: Record<string, SessionPortControls> }>(() => ({ byKey: {} }));

export function useSessionPortControl(id: string): SessionPortControls | null {
    const endpointId = useEndpointId();
    return useSessionPortControls((state) => state.byKey[endpointKey(endpointId, id)] ?? null);
}

export function publishSessionPortControls(key: string, controls: SessionPortControls): () => void {
    useSessionPortControls.setState((state) => ({ byKey: { ...state.byKey, [key]: controls } }));
    return () => {
        useSessionPortControls.setState((state) => {
            if (state.byKey[key] !== controls) {
                return state;
            }
            const byKey = { ...state.byKey };
            delete byKey[key];
            return { byKey };
        });
    };
}
