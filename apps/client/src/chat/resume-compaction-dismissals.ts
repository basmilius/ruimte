import { create } from 'zustand';
import { endpointKey, useEndpointId } from '@/state/keys';

/*
 * Which turn a person answered "Keep full history" on, per chat. In memory only: the offer appears
 * at most once per silence, so a reload asking again costs nothing, and a refusal is not a setting.
 */
const useDismissals = create<{ byKey: Record<string, string> }>(() => ({ byKey: {} }));

export const useResumeCompactionDismissal = (chatId: string): string | null => {
    const endpointId = useEndpointId();
    return useDismissals((s) => s.byKey[endpointKey(endpointId, chatId)] ?? null);
};

export const dismissResumeCompaction = (endpointId: string, chatId: string, turnId: string): void => {
    useDismissals.setState((s) => ({ byKey: { ...s.byKey, [endpointKey(endpointId, chatId)]: turnId } }));
};
