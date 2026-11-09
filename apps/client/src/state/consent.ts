import type { ConsentRequest } from '@ruimte/contracts';
import { create } from 'zustand';

interface ConsentStore {
    /* The clients elsewhere that wait for a person on the machine this window runs, oldest first. */
    requests: readonly ConsentRequest[];
    setRequests(requests: readonly ConsentRequest[]): void;
}

export const useConsent = create<ConsentStore>((set) => ({
    requests: [],
    setRequests(requests) {
        set({ requests });
    }
}));
