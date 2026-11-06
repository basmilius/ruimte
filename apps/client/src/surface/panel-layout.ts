import { useSettings } from '@/state/settings';

export function usePanelGap(): number {
    return useSettings((state) => (state.panelLayout === 'roomy' ? 8 : 0));
}
