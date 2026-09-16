import { create } from 'zustand';

interface SubagentSupportStore {
    /* The machines that answered that they cannot open a subagent's conversation, for this page's life. */
    unsupported: Record<string, true>;
    markUnsupported(endpointId: string): void;
}

/*
 * Whether a machine can open a subagent's conversation is learned by asking once rather than from a
 * version: the first refusal hides the button on that machine's rows that carry no pointer of their own.
 */
export const useSubagentSupport = create<SubagentSupportStore>((set, get) => ({
    unsupported: {},
    markUnsupported(endpointId) {
        if (get().unsupported[endpointId]) {
            return;
        }
        set({ unsupported: { ...get().unsupported, [endpointId]: true } });
    }
}));
