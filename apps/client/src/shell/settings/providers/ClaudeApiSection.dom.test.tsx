import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ClaudeApiStatus, ProjectCanvasView, ProviderInfo } from '@ruimte/contracts';
import { useUi } from '@/state/ui';
import { clickOn, mount, until, type Mounted } from '../../../../testing/dom';
import { FakeMachine } from '../../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../../testing/fake-workspace';

const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };
const DEFAULTS = { autoContinue: false, roundsPerRun: 40, runs: 3, maxOutputTokens: 8192 };

let page: Mounted;
let workspace: FakeWorkspace;
let machine: FakeMachine;
let status: ClaudeApiStatus;

function claudeApi(installed: boolean): ProviderInfo {
    return {
        kind: 'anthropic-claude-api',
        name: 'Claude API',
        installed,
        version: installed ? 'API key' : null,
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
    return [...document.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.startsWith('Claude API'));
}

function keyField(): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>('input[aria-label="API key"]');
}

function numberField(label: string): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
}

async function typeInto(input: HTMLInputElement, text: string): Promise<void> {
    await act(async () => {
        input.focus();
        // React tracks the value it set, so the browser's own setter is what makes the change show.
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

async function leave(input: HTMLInputElement): Promise<void> {
    await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
}

async function openClaudeApi(): Promise<void> {
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setSettings({ open: true, section: 'providers' }));
    await until(() => providerRow() !== undefined);
    await clickOn(providerRow()!);
    await until(() => keyField() !== null);
}

beforeEach(() => {
    status = { configured: false, models: 0, settings: { ...DEFAULTS } };
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [claudeApi(status.configured)] }));
    machine.answer('anthropic.status', () => status);
    machine.answer('anthropic.configure', ({ apiKey, settings }) => {
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

describe('The key of the Claude API in Settings', () => {
    test('is not offered as a CLI to install, and is there to open before a key is saved', async () => {
        await openClaudeApi();
        expect(everything()).toContain('Claude API');
        expect(everything()).toContain('bills every call per token');
        expect(everything()).not.toContain('Not installed');
        expect(everything()).toContain('No key saved on this machine.');
        expect(button('Save')?.disabled).toBe(true);
    });

    test('a saved key goes to the machine once and the field never shows it again', async () => {
        await openClaudeApi();
        await typeInto(keyField()!, '  sk-ant-key  ');
        await clickOn(button('Save')!);
        await until(() => everything().includes('Connected, 3 models available.'));

        expect(machine.requests('anthropic.configure')).toEqual([{ apiKey: 'sk-ant-key' }]);
        expect(keyField()!.value).toBe('');
        expect(keyField()!.placeholder).toBe('Saved');
        expect(everything()).not.toContain('sk-ant-key');
    });

    test('refresh asks again with the saved key and disconnect removes it', async () => {
        status = { configured: true, models: 2, settings: { ...DEFAULTS } };
        await openClaudeApi();
        await until(() => everything().includes('Connected, 2 models available.'));

        await clickOn(button('Refresh models')!);
        await until(() => everything().includes('Connected, 3 models available.'));
        await clickOn(button('Disconnect')!);
        await until(() => everything().includes('No key saved on this machine.'));

        expect(machine.requests('anthropic.configure')).toEqual([{}, { apiKey: '' }]);
    });

    test('a key Anthropic refuses is said in the section and nothing is saved', async () => {
        machine.answer('anthropic.configure', () => {
            throw new Error('Anthropic rejected the API key.');
        });
        await openClaudeApi();
        await typeInto(keyField()!, 'wrong-key');
        await clickOn(button('Save')!);
        await until(() => document.querySelector('[role="alert"]') !== null);

        expect(document.querySelector('[role="alert"]')!.textContent).toContain('Anthropic rejected the API key.');
        expect(everything()).toContain('No key saved on this machine.');
    });
});

describe('How a Claude API chat behaves', () => {
    test('continuing starts off, since every call is paid for, and the switch sends only itself', async () => {
        await openClaudeApi();
        const toggle = document.querySelector<HTMLElement>('[aria-label="Continue automatically"]');
        expect(toggle).not.toBeNull();
        expect(toggle!.getAttribute('aria-checked') ?? toggle!.getAttribute('data-checked')).not.toBe('true');

        await clickOn(toggle);
        await until(() => machine.requests('anthropic.configure').length === 1);
        // Nothing but the setting goes over the wire: no key, so nothing is fetched and the key stays.
        expect(machine.requests('anthropic.configure')).toEqual([{ settings: { autoContinue: true } }]);
    });

    test('the runs field is idle while continuing is off, and ready once it is on', async () => {
        await openClaudeApi();
        expect(numberField('Runs before it stops')!.disabled).toBe(true);
        await clickOn(document.querySelector<HTMLElement>('[aria-label="Continue automatically"]'));
        await until(() => !numberField('Runs before it stops')!.disabled);
    });

    test('a number is sent when the field is left, and only if it is a whole number inside the range and different', async () => {
        await openClaudeApi();
        const rounds = numberField('Tool rounds per run')!;
        expect(rounds.value).toBe('40');
        await typeInto(rounds, '60');
        await leave(rounds);
        await until(() => machine.requests('anthropic.configure').length === 1);
        expect(machine.requests('anthropic.configure')).toEqual([{ settings: { roundsPerRun: 60 } }]);

        // Out of range, not whole and unchanged are all left alone.
        await typeInto(rounds, '3');
        await leave(rounds);
        await typeInto(rounds, '60.5');
        await leave(rounds);
        await typeInto(rounds, '60');
        await leave(rounds);
        expect(machine.requests('anthropic.configure')).toHaveLength(1);
    });

    test('the tokens of a reply have a field of their own, from 1,024 to 128,000', async () => {
        await openClaudeApi();
        const tokens = numberField('Output tokens per reply')!;
        expect(tokens.value).toBe('8192');

        await typeInto(tokens, '500');
        await leave(tokens);
        await typeInto(tokens, '200000');
        await leave(tokens);
        expect(machine.requests('anthropic.configure')).toHaveLength(0);

        await typeInto(tokens, '16000');
        await leave(tokens);
        await until(() => machine.requests('anthropic.configure').length === 1);
        expect(machine.requests('anthropic.configure')).toEqual([{ settings: { maxOutputTokens: 16000 } }]);
    });
});
