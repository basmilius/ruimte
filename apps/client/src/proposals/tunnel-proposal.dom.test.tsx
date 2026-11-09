import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ChatInfo, ProjectView, ProviderInfo, TunnelProposal } from '@ruimte/contracts';
import { act } from 'react';
import { useTunnelProposals } from '@/state/tunnel-proposals';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { fakeProvider } from '../../testing/fake-provider';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const ENDPOINT_ID = 'fake-machine';

const CHAT: ProjectView = { kind: 'chat', id: 'vite-chat', name: 'Vite notes', node: { provider: 'claude' } };

const ADD: TunnelProposal = {
    proposalId: 'proposal-1',
    chatId: CHAT.id,
    action: 'add',
    kind: 'dev',
    hostname: 'ruimte-app.bmnw.nl',
    port: 5173,
    origin: { https: true, hostHeader: 'ruimte.test' },
    reason: 'So you can try it on your phone',
    stale: false,
    createdAt: 1,
    expiresAt: 2
};

const CLAUDE = fakeProvider('claude', 'Claude Code', {
    version: '2.1.0',
    capabilities: { chat: true, terminal: true, hooks: true, attachments: true, mentions: true, slashCommands: true } as ProviderInfo['capabilities'],
    resumeCommand: 'claude --resume {id}'
});

function infoOf(chatId: string): ChatInfo {
    return {
        chatId,
        provider: 'claude',
        cwd: '/work/vite',
        agentSessionId: null,
        model: null,
        selection: { model: 'model', options: {} },
        runtimeMode: 'supervised',
        status: 'needs-you',
        running: false,
        activeTurnId: null,
        slashCommands: [],
        usage: { turns: 0, contextTokens: 0, contextWindow: 200_000, costUsd: 0 },
        background: []
    } as unknown as ChatInfo;
}

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function text(): string {
    return page.host.textContent ?? '';
}

function button(label: string): HTMLButtonElement | null {
    return ([...page.host.querySelectorAll('button')] as HTMLButtonElement[]).find((entry) => entry.textContent?.trim() === label) ?? null;
}

async function show(proposals: TunnelProposal[]): Promise<void> {
    await act(async () => useTunnelProposals.getState().setProposals(ENDPOINT_ID, proposals));
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: infoOf(chatId), items: [], seq: 0 }) as never);
    machine.answer('tunnel.proposalDecline', () => ({ accepted: true }));
    workspace = await openFakeWorkspace(machine, { views: [CHAT] } as never, { activeViewId: CHAT.id, views: {} });
    page = mount();
    await page.renderApp();
    await show([ADD]);
    await until(() => text().includes('Add ruimte-app.bmnw.nl → port 5173'));
});

afterEach(async () => {
    await act(async () => useTunnelProposals.getState().forget(ENDPOINT_ID));
    await page.unmount();
    workspace.close();
});

describe('an agent that suggests a tunnel hostname', () => {
    test('says what happens, with the warning Settings shows, and changes nothing by looking', () => {
        expect(text()).toContain('https · Host header ruimte.test');
        expect(text()).toContain('So you can try it on your phone');
        expect(text()).toContain('Anyone with the address reaches this dev server.');
        expect(button('Confirm')).not.toBeNull();
        expect(button('Decline')).not.toBeNull();
        expect(machine.requests('tunnel.proposalConfirm')).toHaveLength(0);
    });

    test('Confirm sends one confirm and stays busy while Cloudflare answers', async () => {
        let answer: (value: { accepted: boolean }) => void = () => undefined;

        machine.answer('tunnel.proposalConfirm', () => new Promise((resolve) => (answer = resolve)));
        await clickOn(button('Confirm'));
        await until(() => button('Confirming…') !== null);

        expect(button('Confirming…')!.disabled).toBe(true);
        expect(machine.requests('tunnel.proposalConfirm')).toEqual([{ proposalId: ADD.proposalId }]);

        await act(async () => answer({ accepted: true }));
        await show([]);
        await until(() => !text().includes('Add ruimte-app.bmnw.nl'));
        expect(machine.requests('tunnel.proposalConfirm')).toHaveLength(1);
    });

    test('shows on the card why the machine refused the confirm', async () => {
        machine.answer('tunnel.proposalConfirm', () => {
            throw new Error('Port 4210 belongs to Ruimte itself, and a tunnel never points at it');
        });
        await clickOn(button('Confirm'));
        await until(() => text().includes('Port 4210 belongs to Ruimte itself'));

        expect(button('Confirm')!.disabled).toBe(false);
    });

    test('Decline tells the machine and confirms nothing', async () => {
        await clickOn(button('Decline'));
        await until(() => machine.requests('tunnel.proposalDecline').length === 1);

        expect(machine.requests('tunnel.proposalDecline')).toEqual([{ proposalId: ADD.proposalId }]);
        expect(machine.requests('tunnel.proposalConfirm')).toHaveLength(0);
    });

    test('a stale card says the hostname changed and only declines', async () => {
        await show([{ ...ADD, action: 'off', origin: undefined, reason: undefined, stale: true }]);
        await until(() => text().includes('ruimte-app.bmnw.nl changed since the agent asked.'));

        expect(text()).toContain('Turn off ruimte-app.bmnw.nl');
        expect(text()).not.toContain('Anyone with the address');
        expect(button('Confirm')!.disabled).toBe(true);
        expect(button('Decline')!.disabled).toBe(false);
    });
});
