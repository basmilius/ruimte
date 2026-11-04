import { afterEach, describe, expect, test } from 'bun:test';
import type { ClaudeApiSettings, NanoGptSettings, ProviderInfo } from '@ruimte/contracts';
import { act } from 'react';
import { useUi } from '@/state/ui';
import { clickOn, mount, until, type Mounted } from '../../../../testing/dom';
import { buttonWithText, everything, typeInto } from '../../../../testing/dom-helpers';
import { FakeMachine } from '../../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../../testing/fake-workspace';
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

/* Claude Code, which the Claude API runs in. */
function claudeCode(installed: boolean): ProviderInfo {
    const base = info(CLAUDE_API, installed);

    return { ...base, kind: 'claude', name: 'Claude Code', version: installed ? '2.1.320' : null, capabilities: { ...base.capabilities, terminal: true } };
}

/* Opens the provider on a machine that answers its two requests from one status a test may change. */
async function open(provider: Provider, configured = false, claudeInstalled = true): Promise<void> {
    let status = { configured, models: configured ? 2 : 0, settings: { ...provider.defaults } };
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({
        providers: [...(provider === CLAUDE_API ? [claudeCode(claudeInstalled)] : []), info(provider, status.configured && claudeInstalled)]
    }));
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
        [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((candidate) => candidate.textContent?.startsWith(provider.name));

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
});

describe('The runs of NanoGPT in Settings', () => {
    const provider = NANOGPT;

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
    test('is not offered as a CLI to install, and has no runs to count since Claude Code runs the chat', async () => {
        await open(CLAUDE_API);
        expect(everything()).toContain('bills every call per token');
        expect(everything()).not.toContain('Not installed');
        // Its own mark, not Claude's, whose label needs the even-odd rule to show.
        expect(document.querySelector('[role="dialog"] svg[aria-label="Claude API"] path')?.getAttribute('fill-rule')).toBe('evenodd');
        // The key and what it brought each have a row of their own.
        const titled = (text: string) =>
            [...document.querySelectorAll('[role="dialog"] *')].filter((element) => element.children.length === 0 && element.textContent === text);
        expect(titled('API key')).toHaveLength(1);
        expect(titled('Connection')).toHaveLength(1);
        expect(continueSwitch()).toBeNull();
        expect(field('Steps per run')).toBeNull();
        expect(everything()).not.toContain('Install it on this machine first.');
    });

    test('without Claude Code on the machine it says so and leads to its install', async () => {
        await open(CLAUDE_API, false, false);
        await until(() => everything().includes('Claude API chats run in Claude Code. Install it on this machine first.'));
        expect(everything()).toContain('Claude Code is not installed');

        await clickOn(buttonWithText('Install')!);
        expect(useUi.getState().settings.target).toBe('providers.install.claude');
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

    test('new chats start on a 200K context window until a person picks 1M', async () => {
        await open(CLAUDE_API);
        const choice = (label: string) =>
            [...document.querySelectorAll<HTMLElement>('[role="radiogroup"][aria-label="Context window"] [role="radio"]')].find(
                (element) => element.textContent === label
            )!;
        expect(everything()).toContain('Used for new chats. You can switch per chat.');
        expect(choice('200K').getAttribute('aria-checked')).toBe('true');

        await clickOn(choice('1M'));
        await until(() => machine.requests('anthropic.configure').length === 1);
        expect(machine.requests('anthropic.configure')).toEqual([{ settings: { contextWindow: '1m' } }]);
        await until(() => choice('1M').getAttribute('aria-checked') === 'true');
    });
});
