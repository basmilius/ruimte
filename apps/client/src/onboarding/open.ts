import { onboardingDialog } from '@/onboarding/dialog';
import { hasLocalMachine } from '@/state/local-machine';
import { useSettings } from '@/state/settings';

/* The list of tasks, from About, the menu or the palette. Only a client with a machine of its own has one. */
export function openOnboarding(local: boolean = hasLocalMachine()): void {
    if (local) {
        onboardingDialog.set('hub');
    }
}

/* Putting it off, closing it and finishing it all count as having met it. */
export function closeOnboarding(): void {
    const { onboardingSeen, onboardingSkipWelcome } = useSettings.getState();
    if (!onboardingSeen || onboardingSkipWelcome) {
        useSettings.getState().update({ onboardingSeen: true, onboardingSkipWelcome: false });
    }
    onboardingDialog.set(null);
}

/*
 * Shows the welcome once per client, at the first start with a machine of its own. A window that hears
 * another one answer it puts its own welcome away, since the person already did; a list a person opened
 * stays.
 */
export function startOnboarding(local: boolean = hasLocalMachine()): () => void {
    if (!local) {
        return () => undefined;
    }
    if (!useSettings.getState().onboardingSeen) {
        onboardingDialog.set(useSettings.getState().onboardingSkipWelcome ? 'hub' : 'welcome');
    }
    return useSettings.subscribe((state, before) => {
        if (state.onboardingSeen && !before.onboardingSeen && onboardingDialog.get() === 'welcome') {
            onboardingDialog.set(null);
        }
    });
}
