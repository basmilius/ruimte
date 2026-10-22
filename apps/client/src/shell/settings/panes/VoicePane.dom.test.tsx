import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { REQUEST_SCHEMAS, type RequestType, type VoicePreferences } from '@ruimte/contracts';
import type { DesktopBridge } from '@/desktop/bridge';
import { useSettings } from '@/state/settings';
import { clickOn, mount, until, type Mounted } from '../../../../testing/dom';
import { connectFakeMachine, FakeMachine } from '../../../../testing/fake-machine';
import { machineBridge } from '../../../../testing/machine-bridge';
import { VoicePane } from './VoicePane';

const scope = globalThis as unknown as { window: { ruimteDesktop?: DesktopBridge } };

let page: Mounted;
let machine: FakeMachine;
let release: () => void;
let stored: VoicePreferences | null;

function trigger(label: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
}

async function choose(label: string, option: string): Promise<void> {
    await clickOn(trigger(label));
    await until(() => document.querySelector('[role="option"]') !== null);
    await clickOn([...document.querySelectorAll('[role="option"]')].find((element) => element.textContent?.startsWith(option)) ?? null);
}

async function open(answers: readonly RequestType[] | null = null): Promise<void> {
    machine = new FakeMachine();
    if (answers !== null) {
        machine.answersOnly(answers);
    }
    machine.answer('voice.preferences', () => ({ preferences: stored }));
    machine.answer('voice.setPreferences', (payload) => {
        stored = payload;
        return { preferences: payload };
    });
    release = connectFakeMachine(machine);
    scope.window.ruimteDesktop = {
        platform: 'darwin',
        pickFolder: async () => null,
        openExternal: async () => undefined,
        openGuestDevTools: () => undefined,
        isFullscreen: async () => false,
        onFullscreen: () => () => undefined,
        machine: machineBridge('local'),
        openAi: {
            credentialStatus: async () => ({ configured: true, persistent: true }),
            saveApiKey: async () => ({ configured: true, persistent: true }),
            clearApiKey: async () => ({ configured: false, persistent: true }),
            createLiveSession: async () => ({ session: { id: 'session' }, transport: { type: 'webrtc', sdp: 'v=0' } })
        }
    } as DesktopBridge;
    page = mount();
    await page.render(<VoicePane />);
    await until(() => trigger('Conversation voice') !== null);
}

beforeEach(() => {
    stored = null;
    useSettings.getState().update({ voiceLanguage: 'nl', liveVoice: 'marin' });
});

afterEach(async () => {
    await page.unmount();
    release();
    delete scope.window.ruimteDesktop;
});

describe('Settings > Voice, language and voice of the machine', () => {
    test('a machine that stores none shows what this app used, and a pick stores both there', async () => {
        await open();
        await until(() => trigger('Conversation language')?.textContent?.includes('Nederlands') === true);
        await choose('Conversation language', 'Deutsch');
        await until(() => machine.requests('voice.setPreferences').length === 1);
        expect(machine.requests('voice.setPreferences')).toEqual([{ language: 'de', voice: 'marin' }]);
        expect(trigger('Conversation language')?.textContent).toContain('Deutsch');
        // Speech to Text keeps its own language on this computer.
        expect(useSettings.getState().voiceLanguage).toBe('nl');
    });

    test('follows what another client of the machine sets', async () => {
        stored = { language: 'ja', voice: 'cedar' };
        await open();
        await until(() => trigger('Conversation language')?.textContent?.includes('日本語') === true);
        expect(trigger('Conversation voice')?.textContent).toContain('Cedar');
        await act(async () => machine.emit('voice.preferences', { preferences: { language: 'fr', voice: 'marin' } }));
        await until(() => trigger('Conversation language')?.textContent?.includes('Français') === true);
        expect(trigger('Conversation voice')?.textContent).toContain('Marin');
    });

    test('a machine that keeps none of its own leaves both to this app, as before', async () => {
        const older = (Object.keys(REQUEST_SCHEMAS) as RequestType[]).filter((type) => type !== 'voice.preferences' && type !== 'voice.setPreferences');
        await open(older);
        expect(trigger('Conversation language')).toBeNull();
        await choose('Conversation voice', 'Cedar');
        expect(useSettings.getState().liveVoice).toBe('cedar');
        expect(machine.requests('voice.preferences')).toEqual([]);
        expect(machine.requests('voice.setPreferences')).toEqual([]);
    });
});
