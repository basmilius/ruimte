import { expect, test } from 'bun:test';
import { windowDialogs } from '@/registry/dialogs';

// The unit preload installs the window's wiring as `main.tsx` does; the order is the one a person saw dialogs stack in on main.
test('the window mounts its dialogs in main order, the toasts after the palette, settings, usage and models', () => {
    expect(windowDialogs.all().map((dialog) => dialog.id)).toEqual([
        'palette',
        'settings',
        'usage',
        'models',
        'toasts',
        'release-notes',
        'machine-update',
        'link-request',
        'onboarding',
        'agent-integrations',
        'login',
        'consent',
        'provider-command',
        'template-request'
    ]);
});
