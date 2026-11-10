import { afterEach, describe, expect, test } from 'bun:test';
import { onboardingDialog } from '@/onboarding/dialog';
import { useSettings } from '@/state/settings';
import { closeOnboarding, openOnboarding, startOnboarding } from './open';

let stop: () => void = () => undefined;

afterEach(() => {
    stop();
    useSettings.setState({ onboardingSeen: false, onboardingIntroSeen: false, onboardingSkipWelcome: false });
    onboardingDialog.set(null);
});

describe('meeting the onboarding', () => {
    test('opens on the welcome on a client that never met it, and never without a machine of its own', () => {
        stop = startOnboarding(false);
        expect(onboardingDialog.get()).toBeNull();
        stop = startOnboarding(true);
        expect(onboardingDialog.get()).toBe('welcome');
    });

    test('stays away once met, and comes back on its list when asked', () => {
        useSettings.setState({ onboardingSeen: true });
        stop = startOnboarding(true);
        expect(onboardingDialog.get()).toBeNull();
        openOnboarding(true);
        expect(onboardingDialog.get()).toBe('hub');
    });

    test('counts as met once closed, wherever it stood', () => {
        stop = startOnboarding(true);
        closeOnboarding();
        expect(useSettings.getState().onboardingSeen).toBe(true);
        expect(onboardingDialog.get()).toBeNull();
    });

    test('puts its welcome away when another window answered it, but keeps a list a person opened', () => {
        stop = startOnboarding(true);
        useSettings.setState({ onboardingSeen: true });
        expect(onboardingDialog.get()).toBeNull();
        useSettings.setState({ onboardingSeen: false });
        onboardingDialog.set('hub');
        useSettings.setState({ onboardingSeen: true });
        expect(onboardingDialog.get()).toBe('hub');
    });
});

describe('after the first-run choice', () => {
    test('opens on the list instead of the welcome, and closing clears the mark', () => {
        useSettings.setState({ onboardingSkipWelcome: true });
        stop = startOnboarding(true);
        expect(onboardingDialog.get()).toBe('hub');
        closeOnboarding();
        expect(useSettings.getState().onboardingSkipWelcome).toBe(false);
        expect(useSettings.getState().onboardingSeen).toBe(true);
    });
});
