import { create } from 'zustand';

interface SubagentSupportStore {
    /* The hosts, by scope id, that answered that they cannot open a subagent's conversation, for this page's life. */
    unsupported: Record<string, true>;
    markUnsupported(scopeId: string): void;
}

/*
 * Whether a host can open a subagent's conversation is learned by asking once rather than from a
 * version: the first refusal hides the button on that host's rows that carry no pointer of their own.
 */
export const useSubagentSupport = create<SubagentSupportStore>((set, get) => ({
    unsupported: {},
    markUnsupported(scopeId) {
        if (get().unsupported[scopeId]) {
            return;
        }
        set({ unsupported: { ...get().unsupported, [scopeId]: true } });
    }
}));
