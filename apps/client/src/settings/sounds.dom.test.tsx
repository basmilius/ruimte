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

async function pick(option: string): Promise<void> {
    await until(() => document.querySelector('[role="option"]') !== null);
    await clickOn([...document.querySelectorAll('[role="option"]')].find((row) => row.textContent?.includes(option)) ?? null);
}

async function openAgents(): Promise<void> {
    await act(async () => useUi.getState().setSettings({ open: true, section: 'agents', target: 'agents.sounds.pack' }));
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
        soundEvents: before.soundEvents,
        customSoundPacks: before.customSoundPacks,
        projectSounds: before.projectSounds
    });
});

describe('Settings > Agents > Notifications > Sounds', () => {
    test('every event is off until turned on, and a pack and an event stay chosen after the settings are read again', async () => {
        await openAgents();
        expect(switchOf('A turn finishes')?.getAttribute('aria-checked')).toBe('false');

        await clickOn(buttonWithText('Bar'));
        await pick('Glass');
        await clickOn(switchOf('A turn finishes'));
        await act(async () => useSettings.getState().reload());

        expect(useSettings.getState()).toMatchObject({ soundPack: 'glass', soundEvents: { finished: true, question: false } });
        expect(buttonWithText('Glass')).not.toBeNull();
        expect(switchOf('A turn finishes')?.getAttribute('aria-checked')).toBe('true');
    });

    test('the play button of a row plays that event in the chosen pack', async () => {
        await openAgents();
        await clickOn(buttonWithText('Bar'));
        await pick('Grand');
        await clickOn(labelled('Play the sound for: A usage limit is hit'));
        await until(() => played.length === 1);

        expect(played).toEqual(['grand/fall.wav']);
    });

    test('a new pack takes a name and a file, and plays that file', async () => {
        await openAgents();
        await clickOn(buttonWithText('Bar'));
        await pick('New pack');
        await until(() => labelled<HTMLInputElement>('Name of the pack') !== null);
        await typeInto(labelled<HTMLInputElement>('Name of the pack')!, 'Office');

        const pack = useSettings.getState().customSoundPacks[0]!;

        expect(pack.name).toBe('Office');
        expect(useSettings.getState().soundPack).toBe(pack.id);
        expect(everything()).toContain('No file yet');
        expect(labelled<HTMLButtonElement>('Play the sound for: A question or approval waits')?.disabled).toBe(true);

        await clickOn(labelled('Choose the file for: A question or approval waits'));
        const input = document.querySelector<HTMLInputElement>('input[type="file"][accept="audio/*"]')!;
        Object.defineProperty(input, 'files', { configurable: true, value: [new File([new Uint8Array(8)], 'ping.wav', { type: 'audio/wav' })] });
        await act(async () => {
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await until(() => everything().includes('ping.wav'));

        expect(kept.get(`${pack.id}/question`)?.size).toBe(8);
        await clickOn(labelled('Play the sound for: A question or approval waits'));
        await until(() => played.length === 1);
    });
});

describe('Project settings > Sounds', () => {
    test('a project follows the settings until it takes a pack of its own or is silent, and another project is left alone', async () => {
        const { current, currentEndpointId } = useProject.getState();
        const key = projectSoundKey(currentEndpointId!, current!.projectId);

        await act(async () => projectSettingsAsk.set(true));
        await until(() => buttonWithText('As in Settings (Bar)') !== null);
        await clickOn(buttonWithText('As in Settings (Bar)'));
        await pick('Nylon');
        expect(useSettings.getState().projectSounds).toEqual({ [key]: { pack: 'nylon' } });

        await clickOn(switchOf('Silent'));
        expect(useSettings.getState().projectSounds).toEqual({ [key]: { silent: true, pack: 'nylon' } });
        expect(useSettings.getState().soundPack).toBe('bar');
    });
});
