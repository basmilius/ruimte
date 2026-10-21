import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProviderInfo } from '@ruimte/contracts';
import { startProviderDetection } from '@/transport/provider-detection';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, openSubmenu, until, type Mounted } from '../../testing/dom';

function providerOf(kind: string, name: string, installed: boolean): ProviderInfo {
    return {
        kind,
        name,
        installed,
        version: installed ? '1.0.0' : null,
        models: [{ slug: 'model', name: 'Model', legacy: false, isDefault: true, options: [] }],
        defaultModel: 'model',
        capabilities: { chat: true, terminal: true },
        resumeCommand: null
    } as unknown as ProviderInfo;
}

// A canvas with something on it, since an empty one offers the agents itself and would ask before the test does.
const MAIN: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    nodes: [],
    texts: [{ id: 'label', x: 0, y: 0, text: 'Note', size: 16 }],
    edges: [],
    layouts: []
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let stopDetection: () => void;
let grokInstalled: boolean;

function menuLabels(): string[] {
    return [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((item) => item.textContent?.trim() ?? '');
}

function providers(): ProviderInfo[] {
    return [providerOf('claude', 'Claude Code', true), providerOf('grok', 'Grok', grokInstalled)];
}

beforeEach(async () => {
    grokInstalled = false;
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: providers() }));
    machine.answer('provider.detect', () => ({ providers: providers() }));
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    stopDetection = startProviderDetection();
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    stopDetection();
    await page.unmount();
    workspace.close();
});

describe('looking for agent CLIs again', () => {
    test('a CLI installed while the window was away shows up in the new-chat menu once the window has the focus again', async () => {
        expect(machine.requests('provider.detect').length).toBe(0);
        grokInstalled = true;
        await act(async () => {
            window.dispatchEvent(new Event('focus'));
        });
        await until(() => machine.requests('provider.detect').length === 1);

        await clickOn(page.host.querySelector('[aria-label="Add"]') as HTMLElement);
        await until(() => document.querySelector('[role="menu"]') !== null);
        await openSubmenu('Agent (Chat)');
        await until(() => menuLabels().includes('Grok'));
        expect(menuLabels()).toContain('Claude Code');
        expect(machine.requests('provider.detect').length).toBe(1);
    });

    test('a machine that does not answer provider.detect is asked for its list instead', async () => {
        machine.answersOnly(['provider.list']);
        const lists = machine.requests('provider.list').length;
        await act(async () => {
            window.dispatchEvent(new Event('focus'));
        });
        await until(() => machine.requests('provider.list').length > lists);
        expect(machine.requests('provider.detect').length).toBe(0);
    });
});
