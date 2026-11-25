import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { setCustomSoundFiles, setSoundFileSeconds } from '@/attention/custom-sounds';
import { setSoundPorts } from '@/attention/sounds';
import { projectSettingsAsk } from '@/project/dialogs';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { projectSoundKey } from '@/state/sounds';
import { useUi } from '@/state/ui';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { buttonWithText, everything, typeInto } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

let workspace: FakeWorkspace;
let page: Mounted;
let played: string[];
let kept: Map<string, Blob>;
let restoreSound: () => void;
let before: ReturnType<typeof useSettings.getState>;

function switchOf(label: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[role="switch"][aria-label="${label}"]`);
}

function labelled<T extends HTMLElement>(label: string): T | null {
    return document.querySelector<T>(`[aria-label="${label}"]`);
}

function tab(name: string): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((candidate) => candidate.textContent?.trim() === name) ?? null;
}

async function pick(option: string): Promise<void> {
    await until(() => document.querySelector('[role="option"]') !== null);
    await clickOn([...document.querySelectorAll('[role="option"]')].find((row) => row.textContent?.includes(option)) ?? null);
}

async function openNotifications(): Promise<void> {
    await act(async () => useUi.getState().setSettings({ open: true, section: 'notifications', target: 'agents.sounds.pack' }));
    await until(() => everything().includes('Sound pack'));
}

beforeEach(async () => {
    before = useSettings.getState();
    played = [];
    kept = new Map();
    restoreSound = setSoundPorts({ play: async (url) => void played.push(url.slice(url.lastIndexOf('/sounds/') + 8)), now: () => 0 });
    setSoundFileSeconds(async () => 0.4);
    setCustomSoundFiles({
        read: async (pack, event) => kept.get(`${pack}/${event}`) ?? null,
        write: async (pack, event, file) => void kept.set(`${pack}/${event}`, file),
        remove: async (pack, event) => void kept.delete(`${pack}/${event}`)
    });
    useSettings.getState().update({ soundPack: 'marimba-low' });
    workspace = await openFakeWorkspace(new FakeMachine(), { views: [] } as never, { activeViewId: null, views: {} } as never);
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await act(async () => {
        useUi.getState().setSettings({ open: false, target: null });
        projectSettingsAsk.set(false);
    });
    await page.unmount();
    workspace.close();
    restoreSound();
    setSoundFileSeconds(null);
    setCustomSoundFiles(null);
    useSettings.getState().update({
        soundPack: before.soundPack,
        notifyEvents: before.notifyEvents,
        customSoundPacks: before.customSoundPacks,
        projectSounds: before.projectSounds
    });
});

describe('Settings > General > Notifications', () => {
    test('a question and an alert notify from the start, and a pack and an event stay chosen after the settings are read again', async () => {
        await openNotifications();
        expect(switchOf('Questions and approvals')?.getAttribute('aria-checked')).toBe('true');
        expect(switchOf('Alerts from agents')?.getAttribute('aria-checked')).toBe('true');
        expect(switchOf('Finished turns')?.getAttribute('aria-checked')).toBe('false');

        await clickOn(buttonWithText('Marimba Low'));
        await pick('Log');
        await clickOn(switchOf('Finished turns'));
        await act(async () => useSettings.getState().reload());

        expect(useSettings.getState()).toMatchObject({ soundPack: 'log', notifyEvents: { finished: true, question: true } });
        expect(buttonWithText('Log')).not.toBeNull();
        expect(switchOf('Finished turns')?.getAttribute('aria-checked')).toBe('true');
    });

    test('the preview of an event shows its notification, with its sound only while a pack plays one', async () => {
        const raised: { title: string; body: string | undefined }[] = [];
        const original = Object.getOwnPropertyDescriptor(globalThis, 'Notification');

        class FakeNotification {
            static permission = 'granted';
            onclick: (() => void) | null = null;

            constructor(title: string, options: NotificationOptions) {
                raised.push({ title, body: options.body });
            }

            close(): void {}
        }

        Object.defineProperty(globalThis, 'Notification', { configurable: true, value: FakeNotification });

        try {
            await openNotifications();
            await clickOn(buttonWithText('Marimba Low'));
            await pick('Vibes');
            await clickOn(labelled('Preview: Usage limits'));
            await until(() => played.length === 1);

            await clickOn(buttonWithText('Vibes'));
            await pick('No sound');
            await clickOn(labelled('Preview: Finished turns'));

            expect(raised).toEqual([
                { title: 'Example chat', body: 'Stopped on a usage limit' },
                { title: 'Example chat', body: 'Finished' }
            ]);
            expect(played).toEqual(['vibes/fall.wav']);
        } finally {
            if (original) {
                Object.defineProperty(globalThis, 'Notification', original);
            } else {
                Reflect.deleteProperty(globalThis, 'Notification');
            }
        }
    });

    test('a pack plays a sample from the list without being picked, and the list stays open', async () => {
        await openNotifications();
        await clickOn(buttonWithText('Marimba Low'));
        await until(() => labelled('Play Vibes') !== null);
        await clickOn(labelled('Play Vibes'));
        await until(() => played.length === 1);

        expect(played).toEqual(['vibes/trio.wav']);
        expect(useSettings.getState().soundPack).toBe('marimba-low');
        expect(labelled('Play Log')).not.toBeNull();
        expect(labelled('Play No sound')).toBeNull();
    });

    test('a new pack takes a name and a file, and plays that file', async () => {
        await openNotifications();
        await clickOn(buttonWithText('Marimba Low'));
        await pick('New pack');
        await until(() => labelled<HTMLInputElement>('Name of the pack') !== null);
        await typeInto(labelled<HTMLInputElement>('Name of the pack')!, 'Office');

        const pack = useSettings.getState().customSoundPacks[0]!;

        expect(pack.name).toBe('Office');
        expect(useSettings.getState().soundPack).toBe(pack.id);
        expect(everything()).toContain('No file, sounds as in Marimba Low');
        await clickOn(labelled('Play the sound for: Usage limits'));
        await until(() => played.length === 1);
        expect(played).toEqual(['marimba-low/fall.wav']);

        await clickOn(labelled('Turn off in this pack: Usage limits'));
        expect(useSettings.getState().customSoundPacks[0]?.off).toEqual(['limit']);
        expect(everything()).toContain('Off in this pack');
        expect(labelled<HTMLButtonElement>('Play the sound for: Usage limits')?.disabled).toBe(true);
        await clickOn(labelled('Turn on in this pack: Usage limits'));
        expect(useSettings.getState().customSoundPacks[0]?.off).toBeUndefined();

        await clickOn(labelled('Choose the file for: Questions and approvals'));
        const input = document.querySelector<HTMLInputElement>('input[type="file"][accept="audio/*"]')!;
        Object.defineProperty(input, 'files', { configurable: true, value: [new File([new Uint8Array(8)], 'ping.wav', { type: 'audio/wav' })] });
        await act(async () => {
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await until(() => everything().includes('ping.wav'));

        expect(kept.get(`${pack.id}/question`)?.size).toBe(8);
        await clickOn(labelled('Play the sound for: Questions and approvals'));
        await until(() => played.length === 2);
    });
});

describe('Project settings > Sounds', () => {
    test('a project follows the settings until it takes a pack of its own or no sound, and the settings keep their pack', async () => {
        const { current, currentEndpointId } = useProject.getState();
        const key = projectSoundKey(currentEndpointId!, current!.projectId);

        await act(async () => projectSettingsAsk.set(true));
        await until(() => tab('Sounds') !== null);
        await clickOn(tab('Sounds'));
        await until(() => buttonWithText('As in Settings (Marimba Low)') !== null);
        await clickOn(buttonWithText('As in Settings (Marimba Low)'));
        await pick('Tine');
        expect(useSettings.getState().projectSounds).toEqual({ [key]: { pack: 'tine' } });

        await clickOn(buttonWithText('Tine'));
        await pick('No sound');
        expect(useSettings.getState().projectSounds).toEqual({ [key]: { pack: 'none' } });
        expect(useSettings.getState().soundPack).toBe('marimba-low');
    });

    test('a project takes a new pack of its own with a name and a file, and the settings keep their pack', async () => {
        const { current, currentEndpointId } = useProject.getState();
        const key = projectSoundKey(currentEndpointId!, current!.projectId);

        await act(async () => projectSettingsAsk.set(true));
        await until(() => tab('Sounds') !== null);
        await clickOn(tab('Sounds'));
        await until(() => buttonWithText('As in Settings (Marimba Low)') !== null);
        await clickOn(buttonWithText('As in Settings (Marimba Low)'));
        await pick('New pack');
        await until(() => labelled<HTMLInputElement>('Name of the pack') !== null);
        await typeInto(labelled<HTMLInputElement>('Name of the pack')!, 'Atlas calls');

        const pack = useSettings.getState().customSoundPacks[0]!;

        expect(pack.name).toBe('Atlas calls');
        expect(useSettings.getState().projectSounds).toEqual({ [key]: { pack: pack.id } });
        expect(useSettings.getState().soundPack).toBe('marimba-low');
        expect(switchOf('Finished turns')).toBeNull();

        await clickOn(labelled('Choose the file for: Finished turns'));
        const input = document.querySelector<HTMLInputElement>('input[type="file"][accept="audio/*"]')!;
        Object.defineProperty(input, 'files', { configurable: true, value: [new File([new Uint8Array(8)], 'done.wav', { type: 'audio/wav' })] });
        await act(async () => {
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await until(() => everything().includes('done.wav'));

        await clickOn(labelled('Delete pack'));
        await until(() => buttonWithText('As in Settings (Marimba Low)') !== null);
        expect(useSettings.getState().projectSounds).toEqual({});
    });
});
