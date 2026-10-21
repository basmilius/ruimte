import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { NanoGptStatus, ProjectCanvasView, ProviderInfo } from '@ruimte/contracts';
import { useUi } from '@/state/ui';
import { clickOn, mount, until, type Mounted } from '../../../../testing/dom';
import { FakeMachine } from '../../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../../testing/fake-workspace';

const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };

let page: Mounted;
let workspace: FakeWorkspace;
let machine: FakeMachine;
let status: NanoGptStatus;

function nanogpt(installed: boolean): ProviderInfo {
    return {
        kind: 'nanogpt',
        name: 'NanoGPT Subscription',
        installed,
        version: installed ? 'Subscription' : null,
        models: [],
        defaultModel: null,
        capabilities: {
            chat: true,
            terminal: false,
            hooks: false,
            streamsToolOutput: false,
            diffs: 'unified',
            attachments: false,
            mentions: false,
            denyReason: true,
            allowAlways: false,
            asyncQuestions: false,
            compaction: 'none',
            reportsCost: false,
            reportsContextWindow: true,
            reportsThinking: true,
            slashCommands: false
        },
        resumeCommand: ''
    };
}

function everything(): string {
    return document.body.textContent ?? '';
}

function button(label: string): HTMLButtonElement | undefined {
    return [...document.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.trim() === label);
}

/* The row of the provider list, which shows the version beside the name once a key is saved. */
function providerRow(): HTMLButtonElement | undefined {
    return [...document.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.startsWith('NanoGPT Subscription'));
}

function keyField(): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>('input[aria-label="API key"]');
}

async function typeInto(input: HTMLInputElement, text: string): Promise<void> {
    await act(async () => {
        input.focus();
        // React tracks the value it set, so the browser's own setter is what makes the change show.
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

async function openNanoGpt(): Promise<void> {
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setSettings({ open: true, section: 'providers' }));
    await until(() => providerRow() !== undefined);
    await clickOn(providerRow()!);
    await until(() => keyField() !== null);
}

beforeEach(() => {
    status = { configured: false, models: 0, settings: { autoContinue: true, roundsPerRun: 40, runs: 5 } };
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [nanogpt(status.configured)] }));
    machine.answer('nanogpt.status', () => status);
    machine.answer('nanogpt.configure', ({ apiKey, settings }) => {
        if (settings !== undefined && apiKey === undefined) {
            status = { ...status, settings: { ...status.settings!, ...settings } };
            return status;
        }
        status = apiKey === '' ? { ...status, configured: false, models: 0 } : { ...status, configured: true, models: 3 };
        return status;
    });
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await page.unmount();
    workspace.close();
});

function numberField(label: string): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
}

describe('How a NanoGPT chat behaves', () => {
    test('automatic continuing is a switch that sends only itself, and turning it off leaves the runs field idle', async () => {
        await openNanoGpt();
        const toggle = document.querySelector<HTMLElement>('[aria-label="Continue automatically"]');
        expect(toggle).not.toBeNull();
        expect(numberField('Runs before it stops')!.disabled).toBe(false);

        await clickOn(toggle);
        await until(() => numberField('Runs before it stops')!.disabled);
        // Nothing but the setting goes over the wire: no key, so nothing is fetched and the key stays.
        expect(machine.requests('nanogpt.configure')).toEqual([{ settings: { autoContinue: false } }]);
    });

    test('a number is sent when the field is left, and only if it is inside the range and different', async () => {
        await openNanoGpt();
        const rounds = numberField('Tool rounds per run')!;
        expect(rounds.value).toBe('40');

        await typeInto(rounds, '60');
        await act(async () => rounds.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
        await until(() => machine.requests('nanogpt.configure').length === 1);
        expect(machine.requests('nanogpt.configure')).toEqual([{ settings: { roundsPerRun: 60 } }]);

        // Out of range and unchanged are both left alone.
        await typeInto(rounds, '3');
        await act(async () => rounds.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
        await typeInto(rounds, '60');
        await act(async () => rounds.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
        expect(machine.requests('nanogpt.configure')).toHaveLength(1);
    });
});

describe('NanoGPT in Settings', () => {
    test('a saved key goes to the machine once and the field never shows it again', async () => {
        await openNanoGpt();
        expect(everything()).toContain('No key saved on this machine.');
        expect(button('Save')?.disabled).toBe(true);

        await typeInto(keyField()!, '  nano-key  ');
        await clickOn(button('Save')!);
        await until(() => everything().includes('Connected, 3 models included.'));

        expect(machine.requests('nanogpt.configure')).toEqual([{ apiKey: 'nano-key' }]);
        expect(keyField()!.value).toBe('');
        expect(keyField()!.placeholder).toBe('Saved');
    });

    test('refresh asks again with the saved key and disconnect removes it', async () => {
        status = { configured: true, models: 2 };
        await openNanoGpt();
        await until(() => everything().includes('Connected, 2 models included.'));

        await clickOn(button('Refresh models')!);
        await until(() => everything().includes('Connected, 3 models included.'));
        await clickOn(button('Disconnect')!);
        await until(() => everything().includes('No key saved on this machine.'));

        expect(machine.requests('nanogpt.configure')).toEqual([{}, { apiKey: '' }]);
    });

    test('a key NanoGPT refuses is said in the section and nothing is saved', async () => {
        machine.answer('nanogpt.configure', () => {
            throw new Error('NanoGPT rejected the API key.');
        });
        await openNanoGpt();
        await typeInto(keyField()!, 'wrong-key');
        await clickOn(button('Save')!);
        await until(() => document.querySelector('[role="alert"]') !== null);

        expect(document.querySelector('[role="alert"]')!.textContent).toContain('NanoGPT rejected the API key.');
        expect(everything()).toContain('No key saved on this machine.');
    });
});
