import { useUi } from '@/state/ui';

// Restored panel widths must appear on the first paint; only later person-made changes should animate.
export function useInstantWidth(): boolean {
    return useUi((s) => s.panelsRestoring);
}
