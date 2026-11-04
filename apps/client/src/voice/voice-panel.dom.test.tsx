import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { installDesktop, removeDesktop } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();
const VOICE_BUTTON = 'Voice Control: press to toggle, hold to talk';

const matchMedia = window.matchMedia;

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function button(label: string): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

function voiceLog(): Element | null {
    return document.querySelector('[role="log"]');
}

beforeEach(async () => {
    localStorage.clear();
    // The waveform animates on every frame unless motion is reduced, which would keep `act` from ever settling.
    window.matchMedia = (query) => {
        const list = matchMedia.call(window, query);
        if (!query.includes('prefers-reduced-motion')) {
            return list;
        }
        return {
            matches: true,
            media: query,
            onchange: null,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            addListener: () => undefined,
            removeListener: () => undefined,
            dispatchEvent: () => false
        } satisfies MediaQueryList;
    };
    installDesktop({
        openAi: {
            credentialStatus: async () => ({ configured: true, persistent: true }),
            saveApiKey: async () => ({ configured: true, persistent: true }),
            clearApiKey: async () => ({ configured: false, persistent: true }),
            createLiveSession: async () => ({ session: { id: 'session' }, transport: { type: 'webrtc', sdp: 'v=0' } })
        }
    });
    machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} }, {}, { thisMachine: true });
    page = mount();
    await page.renderApp();
    await until(() => button(VOICE_BUTTON) !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    removeDesktop();
    window.matchMedia = matchMedia;
});

/* The rail toggles both panels, so neither has a close button: the open one is the one whose title shows. */
function panelTitle(): string | null {
    return document.querySelector('.panel-title')?.textContent ?? null;
}

describe('Voice Control as a panel', () => {
    test('takes the place of the panel that was open, and the other way round', async () => {
        await clickOn(button(VOICE_BUTTON));
        await until(() => voiceLog() !== null);
        expect(panelTitle()).toBe('Voice Control');
        expect(button(VOICE_BUTTON)!.getAttribute('aria-pressed')).toBe('true');

        await clickOn(button('Files'));
        await until(() => voiceLog() === null);
        expect(panelTitle()).toBe('Files');
        expect(button(VOICE_BUTTON)!.getAttribute('aria-pressed')).toBe('false');

        await clickOn(button(VOICE_BUTTON));
        await until(() => voiceLog() !== null);
        expect(panelTitle()).toBe('Voice Control');
    });
});
