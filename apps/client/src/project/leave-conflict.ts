import { create } from 'zustand';
import { useProject } from '@/state/project';

/* The question on screen, answered once: true leaves the project and its unsaved edits behind. */
export const useLeaveConflict = create<{ answer: ((leave: boolean) => void) | null }>(() => ({ answer: null }));

/*
 * Asked before the project on screen is switched away from or closed. While the conflict dialog is
 * open nothing saves, so leaving then drops every edit made since. Without a conflict the answer is
 * yes at once.
 */
export const confirmLeavingConflict = (): Promise<boolean> => {
    if (useProject.getState().conflict === null) {
        return Promise.resolve(true);
    }
    // A second question replaces the first, which counts as staying.
    useLeaveConflict.getState().answer?.(false);
    return new Promise((resolve) => {
        const answer = (leave: boolean): void => {
            if (useLeaveConflict.getState().answer === answer) {
                useLeaveConflict.setState({ answer: null });
            }
            resolve(leave);
        };
        useLeaveConflict.setState({ answer });
    });
};
