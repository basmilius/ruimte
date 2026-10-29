import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ClaudeApiSettings, NanoGptSettings, ProviderInfo } from '@ruimte/contracts';
import { useUi } from '@/state/ui';
import { clickOn, mount, until, type Mounted } from '../../../../testing/dom';
import { FakeMachine } from '../../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../../testing/fake-workspace';
import { buttonWithText, everything, typeInto } from '../../../../testing/dom-helpers';
import { emptyCanvas } from '../../../../testing/project-fixtures';

const MAIN = emptyCanvas();

interface Provider {
    readonly kind: 'nanogpt' | 'anthropic-claude-api';
    readonly name: string;
    readonly version: string;
    readonly area: 'nanogpt' | 'anthropic';
    readonly vendor: string;
    readonly ready: (count: number) => string;
    readonly defaults: NanoGptSettings | ClaudeApiSettings;
}

const NANOGPT: Provider = {
    kind: 'nanogpt',
    name: 'NanoGPT',
    version: 'Subscription',
    area: 'nanogpt',
    vendor: 'NanoGPT',
    ready: (count) => `Connected, ${count} models included.`,
    defaults: { autoContinue: true, roundsPerRun: 40, runs: 5 }
};

const CLAUDE_API: Provider = {
    kind: 'anthropic-claude-api',
    name: 'Claude API',
    version: 'API key',
    area: 'anthropic',
    vendor: 'Anthropic',
    ready: (count) => `Connected, ${count} models available.`,
    defaults: { autoContinue: false, roundsPerRun: 40, runs: 3, maxOutputTokens: 32_000 }
};

let page: Mounted;
let workspace: FakeWorkspace;
let machine: FakeMachine;

function info(provider: Provider, installed: boolean): ProviderInfo {
    return {
        kind: provider.kind,
        name: provider.name,
        installed,
        version: installed ? provider.version : null,
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

function field(label: string): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
}

function continueSwitch(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[aria-label="Continue automatically"]');
}

async function enter(input: HTMLInputElement, text: string): Promise<void> {
    await typeInto(input, text);
    await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
}

/* Opens the provider on a machine that answers its two requests from one status a test may change. */
async function open(provider: Provider, configured = false): Promise<void> {
    let status = { configured, models: configured ? 2 : 0, settings: { ...provider.defaults } };
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [info(provider, status.configured)] }));
    machine.answer(`${provider.area}.status`, () => status);
    machine.answer(`${provider.area}.configure`, ({ apiKey, settings }: { apiKey?: string; settings?: object }) => {
        if (settings !== undefined && apiKey === undefined) {
            status = { ...status, settings: { ...status.settings, ...settings } };
        } else {
            status = apiKey === '' ? { ...status, configured: false, models: 0 } : { ...status, configured: true, models: 3 };
        }

        return status;
    });
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setSettings({ open: true, section: 'providers' }));

    const row = (): HTMLButtonElement | undefined =>
        [...document.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.startsWith(provider.name));

    await until(() => row() !== undefined);
    await clickOn(row()!);
    await until(() => field('API key') !== null);
}

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await page.unmount();
    workspace.close();
});

describe.each([NANOGPT, CLAUDE_API])('The key of $name in Settings', (provider) => {
    test('a saved key goes to the machine once and the field never shows it again', async () => {
        await open(provider);
        expect(everything()).toContain('No key saved on this machine.');
        expect(buttonWithText('Save')?.disabled).toBe(true);

        await typeInto(field('API key')!, '  secret-key  ');
        await clickOn(buttonWithText('Save')!);
        await until(() => everything().includes(provider.ready(3)));

        expect(machine.requests(`${provider.area}.configure`)).toEqual([{ apiKey: 'secret-key' }]);
        expect(field('API key')!.value).toBe('');
        expect(field('API key')!.placeholder).toBe('Saved');
        expect(everything()).not.toContain('secret-key');
    });

    test('refresh asks again with the saved key and disconnect removes it', async () => {
        await open(provider, true);
        await until(() => everything().includes(provider.ready(2)));

        await clickOn(buttonWithText('Refresh models')!);
        await until(() => everything().includes(provider.ready(3)));
        await clickOn(buttonWithText('Disconnect')!);
        await until(() => everything().includes('No key saved on this machine.'));

        expect(machine.requests(`${provider.area}.configure`)).toEqual([{}, { apiKey: '' }]);
    });

    test('a key the vendor refuses is said in the section and nothing is saved', async () => {
        await open(provider);
        machine.answer(`${provider.area}.configure`, () => {
            throw new Error(`${provider.vendor} rejected the API key.`);
        });
        await typeInto(field('API key')!, 'wrong-key');
        await clickOn(buttonWithText('Save')!);
        await until(() => document.querySelector('[role="alert"]') !== null);

        expect(document.querySelector('[role="alert"]')!.textContent).toContain(`${provider.vendor} rejected the API key.`);
        expect(everything()).toContain('No key saved on this machine.');
    });

    test('the continue switch sends only itself, and the runs field follows it', async () => {
        await open(provider);
        const continuing = provider.defaults.autoContinue;
        expect(field('Runs in a row')!.disabled).toBe(!continuing);

        await clickOn(continueSwitch());
        await until(() => field('Runs in a row')!.disabled === continuing);
        // No key, so nothing is fetched and the key stays.
        expect(machine.requests(`${provider.area}.configure`)).toEqual([{ settings: { autoContinue: !continuing } }]);
    });

    test('a number is sent when the field is left, and only if it is a whole number inside the range and different', async () => {
        await open(provider);
        const rounds = field('Steps per run')!;
        expect(rounds.value).toBe('40');

        await enter(rounds, '60');
        await until(() => machine.requests(`${provider.area}.configure`).length === 1);
        expect(machine.requests(`${provider.area}.configure`)).toEqual([{ settings: { roundsPerRun: 60 } }]);

        await enter(rounds, '3');
        await enter(rounds, '60.5');
        await enter(rounds, '60');
        expect(machine.requests(`${provider.area}.configure`)).toHaveLength(1);
    });
});

describe('The Claude API in Settings', () => {
    test('is not offered as a CLI to install, and starts without continuing since every call is paid for', async () => {
        await open(CLAUDE_API);
        expect(everything()).toContain('bills every call per token');
        expect(everything()).not.toContain('Not installed');
        expect(continueSwitch()!.getAttribute('aria-checked') ?? continueSwitch()!.getAttribute('data-checked')).not.toBe('true');
    });

    test('the tokens of a reply have a field of their own, from 1,024 to 128,000', async () => {
        await open(CLAUDE_API);
        const tokens = field('Output tokens per reply')!;
        expect(tokens.value).toBe('32000');

        await enter(tokens, '500');
        await enter(tokens, '200000');
        expect(machine.requests('anthropic.configure')).toHaveLength(0);

        await enter(tokens, '16000');
        await until(() => machine.requests('anthropic.configure').length === 1);
        expect(machine.requests('anthropic.configure')).toEqual([{ settings: { maxOutputTokens: 16000 } }]);
    });
});
