import { create } from 'zustand';
import { storedText } from '@/state/stored-json';

const stored = storedText('ruimte.review-focus');

export function readOnlyChanges(): boolean {
    return stored.read() === 'changes';
}

interface ReviewFocusStore {
    onlyChanges: boolean;
    setOnlyChanges(on: boolean): void;
}

/* Whether the review of agent changes hides the lines no change is near, on this client. Never part of a project. */
export const useReviewFocus = create<ReviewFocusStore>((set) => ({
    onlyChanges: readOnlyChanges(),
    setOnlyChanges(on) {
        stored.write(on ? 'changes' : 'all');
        set({ onlyChanges: on });
    }
}));
