import type { ConsentRequest, FromMachine } from '@ruimte/contracts';
import { create } from 'zustand';

interface ConsentStore {
    /* The clients elsewhere that wait for a person on the machine this window runs, oldest first. */
    requests: readonly FromMachine<ConsentRequest>[];
    setRequests(requests: readonly FromMachine<ConsentRequest>[]): void;
}

export const useConsent = create<ConsentStore>((set) => ({
    requests: [],
    setRequests(requests) {
        set({ requests });
    }
}));
