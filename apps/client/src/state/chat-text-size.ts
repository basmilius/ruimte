import { create } from 'zustand';
import { dropEndpoint } from '@/state/keys';

export type ChatTextSize = 0 | 1 | 2 | 3;

export const DEFAULT_CHAT_TEXT_SIZE: ChatTextSize = 1;

interface ChatTextSizes {
    byKey: Record<string, ChatTextSize>;
    step(key: string, direction: -1 | 1): void;
    reset(key: string): void;
    forgetMachine(endpointId: string): void;
}

/* A reading preference of this window, kept across view changes and never written into a project. */
export const useChatTextSizes = create<ChatTextSizes>((set) => ({
    byKey: {},
    step(key, direction) {
        set((state) => {
            const current = state.byKey[key] ?? DEFAULT_CHAT_TEXT_SIZE;
            const next = Math.max(0, Math.min(3, current + direction)) as ChatTextSize;

            if (next === current) {
                return state;
            }

            const byKey = { ...state.byKey };

            if (next === DEFAULT_CHAT_TEXT_SIZE) {
                delete byKey[key];
            } else {
                byKey[key] = next;
            }

            return { byKey };
        });
    },
    reset(key) {
        set((state) => {
            if (state.byKey[key] === undefined) {
                return state;
            }

            const byKey = { ...state.byKey };
            delete byKey[key];

            return { byKey };
        });
    },
    forgetMachine(endpointId) {
        set((state) => ({ byKey: dropEndpoint(state.byKey, endpointId) }));
    }
}));
