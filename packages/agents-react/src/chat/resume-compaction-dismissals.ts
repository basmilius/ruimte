import { create } from 'zustand';
import { useChatScope, type ChatScope } from '../scope';

/*
 * Which turn a person answered "Keep full history" on, per chat. In memory only: the offer appears
 * at most once per silence, so a reload asking again costs nothing, and a refusal is not a setting.
 */
const useDismissals = create<{ byKey: Record<string, string> }>(() => ({ byKey: {} }));

export const useResumeCompactionDismissal = (chatId: string): string | null => {
    const { keyOf } = useChatScope();
    return useDismissals((s) => s.byKey[keyOf(chatId)] ?? null);
};

export const dismissResumeCompaction = (scope: ChatScope, chatId: string, turnId: string): void => {
    useDismissals.setState((s) => ({ byKey: { ...s.byKey, [scope.keyOf(chatId)]: turnId } }));
};
