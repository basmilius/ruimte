import { hasLocalMachine } from '@/state/local-machine';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';

/* The list of tasks, from About, the menu or the palette. Only a client with a machine of its own has one. */
export const openOnboarding = (local: boolean = hasLocalMachine()): void => {
    if (local) {
        useUi.getState().setOnboarding('hub');
    }
};

/* Putting it off, closing it and finishing it all count as having met it. */
export const closeOnboarding = (): void => {
    if (!useSettings.getState().onboardingSeen) {
        useSettings.getState().update({ onboardingSeen: true });
    }
    useUi.getState().setOnboarding(null);
};

/*
 * Shows the welcome once per client, at the first start with a machine of its own. A window that hears
 * another one answer it puts its own welcome away, since the person already did; a list a person opened
 * stays.
 */
export const startOnboarding = (local: boolean = hasLocalMachine()): (() => void) => {
    if (!local) {
        return () => undefined;
    }
    if (!useSettings.getState().onboardingSeen) {
        useUi.getState().setOnboarding('welcome');
    }
    return useSettings.subscribe((state, before) => {
        if (state.onboardingSeen && !before.onboardingSeen && useUi.getState().onboarding === 'welcome') {
            useUi.getState().setOnboarding(null);
        }
    });
};
