import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { useProvidersStore } from '@adecore/agents-react/state';
import { isApplePlatform } from '@/desktop/bridge';
import { useAppShortcuts } from '@/shell/app-shortcuts';
import { appCommands } from '@/shell/commands';
import { DEFAULT_KEYS } from '@/shell/default-keys';
import { menuContext } from '@/shell/menu/context';
import { menuModel } from '@/shell/menu/model';
import { isShortcutRecording, removeOverrideOf } from '@/shell/shortcut-overrides';
import { useUi } from '@/state/ui';
import { clickOn, mount, pressKey, until, type Mounted } from '../../../../testing/dom';
import { buttonWithText, everything } from '../../../../testing/dom-helpers';
import { KeyboardPane } from './KeyboardPane';

const apple = isApplePlatform();
const MOD = apple ? { metaKey: true } : { ctrlKey: true };
const ALL_ROWS = Object.keys(DEFAULT_KEYS) as (keyof typeof DEFAULT_KEYS)[];

let page: Mounted;

/* The window's own listener, which the pane's rows have to move. */
function Listener() {
    useAppShortcuts();

    return null;
}

function recorder(name: string): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>(`button[aria-label^="Shortcut for ${name}"]`);
}

function resetButton(name: string): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>(`button[aria-label="Reset ${name} to its default"]`);
}

/* Records a key on a row: clicks it, presses the key, and leaves the row recording when the key was refused. */
async function record(name: string, key: string, modifiers: Parameters<typeof pressKey>[2]): Promise<void> {
    await clickOn(recorder(name));
    await pressKey(document.body, key, modifiers);
}

/* The accelerator the desktop menu gives a command, found at any depth. */
function menuAccelerator(id: string): string | undefined {
    const find = (nodes: readonly Record<string, unknown>[]): string | undefined => {
        for (const node of nodes) {
            if (node.kind === 'command' && node.id === id) {
                return node.accelerator as string | undefined;
            }

            const found = find([
                ...((node.items as Record<string, unknown>[] | undefined) ?? []),
                ...((node.submenu as Record<string, unknown>[] | undefined) ?? [])
            ]);

            if (found !== undefined) {
                return found;
            }
        }

        return undefined;
    };

    return find(menuModel(menuContext('desktop')).menus as unknown as Record<string, unknown>[]);
}

beforeEach(async () => {
    // The menu lists the machine's agents; a run that left half a provider behind must not decide this test.
    useProvidersStore.setState({ byScope: {} });
    useUi.getState().setPaletteOpen(false);
    page = mount();
    await page.render(
        <>
            <KeyboardPane />
            <Listener />
        </>
    );
});

afterEach(async () => {
    await page.unmount();
    removeOverrideOf(ALL_ROWS);
    useUi.getState().setPaletteOpen(false);
});

describe('rebinding in the Keyboard pane', () => {
    test('a recorded key acts, the old one stops, and the panel, the palette and the menu print the new one', async () => {
        await record('Command palette', 'y', { ...MOD, altKey: true });

        expect(recorder('Command palette')!.textContent).toContain('Y');
        expect(isShortcutRecording()).toBe(false);

        await pressKey(document.body, 'k', MOD);
        expect(useUi.getState().paletteOpen).toBe(false);

        await pressKey(document.body, 'y', { ...MOD, altKey: true });
        expect(useUi.getState().paletteOpen).toBe(true);

        expect(menuAccelerator('palette')).toBe('CommandOrControl+Alt+Y');
    });

    test('the palette and the menu print a key a row has now', async () => {
        await record('Settings', 'y', { ...MOD, altKey: true });

        expect(appCommands().find((command) => command.id === 'settings')?.shortcut).toMatchObject({ key: 'Y', alt: true });
        expect(menuAccelerator('settings')).toBe('CommandOrControl+Alt+Y');
    });

    test('a recorded key runs nothing while it is recorded', async () => {
        await clickOn(recorder('Command palette'));
        expect(isShortcutRecording()).toBe(true);

        await pressKey(document.body, 'k', MOD);

        expect(useUi.getState().paletteOpen).toBe(false);
    });

    test('a key another row holds is refused, and the row that holds it is named', async () => {
        const holder = 'Run or restart chosen launch';

        await record('Command palette', 'r', { ...MOD, altKey: true });

        expect(everything()).toContain(`${holder} already uses this key`);
        expect(isShortcutRecording()).toBe(true);

        await pressKey(document.body, 'Escape', {});
        await pressKey(document.body, 'k', MOD);
        expect(useUi.getState().paletteOpen).toBe(true);
    });

    test('a key without Cmd, Ctrl or Alt is refused with the reason', async () => {
        await record('Command palette', 'k', {});
        expect(everything()).toContain(apple ? 'Hold Cmd, Control or Option too' : 'Hold Ctrl or Alt too');

        await pressKey(document.body, 'k', { shiftKey: true });
        expect(everything()).toContain(apple ? 'Hold Cmd, Control or Option too' : 'Hold Ctrl or Alt too');

        await pressKey(document.body, 'Escape', {});
        await pressKey(document.body, 'k', MOD);
        expect(useUi.getState().paletteOpen).toBe(true);
    });

    test('Escape ends the recording and keeps the key', async () => {
        await clickOn(recorder('Command palette'));
        await pressKey(document.body, 'Escape', {});

        expect(isShortcutRecording()).toBe(false);

        await pressKey(document.body, 'k', MOD);
        expect(useUi.getState().paletteOpen).toBe(true);
    });

    test('a changed row can be reset, and an unchanged one has no reset', async () => {
        expect(resetButton('Command palette')).toBeNull();

        await record('Command palette', 'y', { ...MOD, altKey: true });
        await clickOn(resetButton('Command palette'));

        expect(resetButton('Command palette')).toBeNull();

        await pressKey(document.body, 'k', MOD);
        expect(useUi.getState().paletteOpen).toBe(true);
    });

    test('Restore defaults asks first, and then puts every changed row back', async () => {
        await record('Command palette', 'y', { ...MOD, altKey: true });
        await record('Voice Control: press to toggle, hold to talk', 'u', { ...MOD, altKey: true });

        await clickOn(buttonWithText('Restore defaults'));
        await until(() => everything().includes('Restore the default shortcuts?'));
        expect(resetButton('Command palette')).not.toBeNull();

        await clickOn(buttonWithText('Cancel'));
        await until(() => !everything().includes('Restore the default shortcuts?'));
        expect(resetButton('Command palette')).not.toBeNull();

        await clickOn(buttonWithText('Restore defaults'));
        await until(() => everything().includes('Restore the default shortcuts?'));
        await clickOn(buttonWithText('Restore'));
        await until(() => resetButton('Command palette') === null);

        expect(resetButton('Voice Control: press to toggle, hold to talk')).toBeNull();
        await pressKey(document.body, 'k', MOD);
        expect(useUi.getState().paletteOpen).toBe(true);
    });

    test('Restore defaults waits until a key is changed', async () => {
        expect(buttonWithText('Restore defaults')!.disabled).toBe(true);

        await record('Command palette', 'y', { ...MOD, altKey: true });

        expect(buttonWithText('Restore defaults')!.disabled).toBe(false);
    });
});
