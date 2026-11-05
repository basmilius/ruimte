import { afterEach, expect, test } from 'bun:test';
import type { ProviderInfo } from '@ruimte/contracts';
import { act } from 'react';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { mount, until, type Mounted } from '../../../../testing/dom';
import { FakeMachine } from '../../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../../testing/fake-workspace';

const CLAUDE: ProviderInfo = {
    kind: 'claude',
    name: 'Claude Code',
    installed: true,
    version: null,
    resumeCommand: 'claude --resume {id}',
    defaultModel: 'claude-sonnet-5-5',
    capabilities: {
        chat: true,
        terminal: true,
        hooks: true,
        streamsToolOutput: false,
        diffs: 'none',
        attachments: false,
        mentions: false,
        denyReason: false,
        allowAlways: false,
        asyncQuestions: false,
        compaction: 'none',
        reportsCost: false,
        reportsContextWindow: false,
        reportsThinking: false,
        slashCommands: false
    },
    models: [
        { slug: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', legacy: false, isDefault: true, options: [] },
        { slug: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', legacy: false, isDefault: false, options: [] }
    ]
};

let workspace: FakeWorkspace | undefined;
let page: Mounted | undefined;

afterEach(async () => {
    await page?.unmount();
    workspace?.close();
    useUi.getState().setSettings({ open: false, section: 'appearance', target: null });
    useSettings.setState({ aiInlineAgent: { provider: 'claude', model: null }, aiAssistAgent: null });
});

test("Editor AI shows the CLI's own Sonnet for an inline edit with no model chosen, and Haiku once it is chosen", async () => {
    const machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
    machine.answer('editor.status', () => ({ available: true, provider: 'claude' as const, model: 'claude-haiku-5-5', modelName: 'Claude Haiku 5.5' }));
    workspace = await openFakeWorkspace(machine, { views: [] } as never, { activeViewId: null, views: {} });
    useSettings.setState({ aiInlineAgent: { provider: 'claude', model: null }, aiAssistAgent: null });
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setSettings({ open: true, section: 'editor', target: 'editor.ai.inlineAgent' }));
    const modelButtons = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
    await until(() => modelButtons().some((button) => button.textContent?.includes('Claude Sonnet 5.5')));
    expect(modelButtons().some((button) => button.textContent?.includes('Claude Haiku 5.5'))).toBe(false);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Code is sent to the selected provider.');

    await act(async () => useSettings.setState({ aiInlineAgent: { provider: 'claude', model: 'claude-haiku-5-5' } }));
    await until(() => modelButtons().some((button) => button.textContent?.includes('Claude Haiku 5.5')));
    expect(modelButtons().some((button) => button.textContent?.includes('Claude Sonnet 5.5'))).toBe(false);
});
