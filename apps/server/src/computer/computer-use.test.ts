import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionEvent } from '../sessions/manager.ts';
import { APPROVAL_WAIT_MS, CARD_MS } from './approvals.ts';
import { computerSetup, SHELL_APP, TEXT_EDIT, until } from './computer-test-helpers.ts';
import { agentWords, overlayWords, resolveApp } from './computer-use.ts';

const codeOf = async (work: Promise<unknown>): Promise<string> => {
    try {
        await work;
    } catch (error) {
        return (error as { code?: string }).code ?? 'no-code';
    }
    return 'no-refusal';
};

describe('computer use', () => {
    test('refuses every call while it is off, and never starts the helper for one', async () => {
        const { computer, helper, launches } = await computerSetup({ enabled: false });
        helper.running = false;
        expect(await codeOf(computer.apps('chat-1'))).toBe('computer-use-off');
        expect(await codeOf(computer.operate('chat-1', 'state', 'TextEdit', {}))).toBe('computer-use-off');
        expect(launches).toEqual([]);
        expect(helper.requests).toEqual([]);
    });

    test('starts the helper on demand with the secret on every request', async () => {
        const { computer, helper, launches } = await computerSetup({ enabled: false });
        helper.running = false;
        await computer.setEnabled(true, 'nl');
        expect(launches).toEqual(['/Applications/Ruimte Computer Use.app']);
        expect(helper.requests.every((request) => request.secret === 'secret')).toBe(true);
        expect(computer.status()).toMatchObject({ enabled: true, running: true, accessibility: true, screenRecording: true });
    });

    test('writes the words of the pill in the language it was turned on in', async () => {
        const { home } = await computerSetup({ enabled: false }).then(async (setup) => {
            await setup.computer.setEnabled(true, 'nl-NL');
            return setup;
        });
        expect(JSON.parse(await readFile(join(home, 'computer-use', 'overlay.json'), 'utf8'))).toEqual({
            title: 'Ruimte bedient je computer',
            hint: 'Esc om te stoppen'
        });
        expect(overlayWords(undefined).title).toBe('Ruimte is using your computer');
        expect(overlayWords('fr').title).toBe('Ruimte is using your computer');
    });

    test('turning it off quits the helper and takes every card down', async () => {
        const { computer, helper } = await computerSetup();
        const call = codeOf(computer.operate('chat-1', 'state', 'TextEdit', {}));
        await until(() => computer.pendingApprovals().length === 1);
        await computer.setEnabled(false, undefined);
        expect(await call).toBe('declined');
        expect(computer.pendingApprovals()).toEqual([]);
        expect(helper.running).toBe(false);
        expect(computer.status()).toMatchObject({ enabled: false, running: false });
    });

    test('lists apps without asking anybody, with how the caller stands with each', async () => {
        const { computer } = await computerSetup();
        const { apps } = await computer.apps('chat-1');
        expect(apps.map(({ app, access }) => [app.name, access])).toEqual([
            ['TextEdit', 'ask'],
            ['Shells', 'terminal']
        ]);
        expect(computer.pendingApprovals()).toEqual([]);
    });

    test('refuses a missing Accessibility grant before it names an app', async () => {
        const { computer, helper } = await computerSetup();
        helper.accessibility = false;
        expect(await codeOf(computer.operate('chat-1', 'state', 'TextEdit', {}))).toBe('not-granted');
    });
});

describe('the approval of an app', () => {
    test('holds the call for a bounded time, then says the card is up', async () => {
        const { computer, timers } = await computerSetup();
        const events: SessionEvent[] = [];
        computer.subscribe('client-1', (event) => events.push(event));
        const call = computer.operate('chat-1', 'state', 'TextEdit', {});
        await until(() => computer.pendingApprovals().length === 1);
        const [card] = computer.pendingApprovals();
        expect(card).toMatchObject({
            nodeId: 'chat-1',
            surface: 'chat',
            nodeTitle: 'Node chat-1',
            projectName: 'Ruimte',
            app: { name: 'TextEdit', bundleId: TEXT_EDIT.bundleId },
            command: 'state',
            expiresAt: card!.createdAt + CARD_MS
        });
        expect(events.at(-1)).toEqual({ event: 'computer.approvals', payload: { approvals: [card!] } });
        timers.advance(APPROVAL_WAIT_MS);
        expect(await codeOf(call)).toBe('awaiting-approval');
        // The card stays for the person after the call gave up.
        expect(computer.pendingApprovals()).toHaveLength(1);
    });

    test('a second call joins the card that stands instead of raising another', async () => {
        const { computer, timers } = await computerSetup();
        const first = computer.operate('chat-1', 'state', 'TextEdit', {});
        await until(() => computer.pendingApprovals().length === 1);
        timers.advance(APPROVAL_WAIT_MS);
        await codeOf(first);
        const second = computer.operate('chat-1', 'click', 'TextEdit', { element: 1 });
        await until(() => computer.pendingApprovals()[0]!.expiresAt === timers.now + CARD_MS);
        expect(computer.pendingApprovals()).toHaveLength(1);
        timers.advance(APPROVAL_WAIT_MS);
        await codeOf(second);
    });

    test('"this time" lets the waiting call through and holds for that run of the chat only', async () => {
        const { computer, helper, runs } = await computerSetup();
        const call = computer.operate('chat-1', 'state', 'TextEdit', {});
        await until(() => computer.pendingApprovals().length === 1);
        expect(await computer.answer(computer.pendingApprovals()[0]!.requestId, 'once')).toBe(true);
        expect((await call).tree).toHaveLength(2);
        // The helper was told the pid a person let in, never the name the agent typed.
        expect(helper.acted.at(-1)).toMatchObject({ command: 'state', app: '501' });
        await computer.operate('chat-1', 'click', 'TextEdit', { element: 1 });
        expect(helper.acted.at(-1)).toMatchObject({ command: 'click', element: 1 });

        // Another agent, and the same chat after its conversation started over, are asked again.
        const other = codeOf(computer.operate('term-1', 'state', 'TextEdit', {}));
        await until(() => computer.pendingApprovals().length === 1);
        expect(computer.pendingApprovals()[0]!.surface).toBe('terminal');
        runs.set('chat-1', 'chat:fresh');
        const again = codeOf(computer.operate('chat-1', 'state', 'TextEdit', {}));
        await until(() => computer.pendingApprovals().length === 2);
        for (const card of computer.pendingApprovals()) {
            await computer.answer(card.requestId, 'deny');
        }
        expect(await other).toBe('declined');
        expect(await again).toBe('declined');
    });

    test('"always" holds for every agent and survives a restart', async () => {
        const first = await computerSetup();
        const call = first.computer.operate('chat-1', 'state', 'TextEdit', {});
        await until(() => first.computer.pendingApprovals().length === 1);
        await first.computer.answer(first.computer.pendingApprovals()[0]!.requestId, 'always');
        await call;
        const grants = JSON.parse(await readFile(join(first.home, 'computer-use', 'grants.json'), 'utf8'));
        expect(grants.always).toEqual([{ bundleId: TEXT_EDIT.bundleId, name: 'TextEdit', at: first.timers.now }]);

        const restarted = await computerSetup({ home: first.home, enabled: false });
        expect(restarted.computer.enabled).toBe(true);
        await restarted.computer.operate('term-1', 'state', 'TextEdit', {});
        expect(restarted.computer.pendingApprovals()).toEqual([]);
        expect((await restarted.computer.apps('term-1')).apps[0]!.access).toBe('always');
    });

    test('a no reaches the agent once, on the call after it when none was waiting', async () => {
        const { computer, timers } = await computerSetup();
        const call = computer.operate('chat-1', 'state', 'TextEdit', {});
        await until(() => computer.pendingApprovals().length === 1);
        timers.advance(APPROVAL_WAIT_MS);
        expect(await codeOf(call)).toBe('awaiting-approval');
        await computer.answer(computer.pendingApprovals()[0]!.requestId, 'deny');
        expect(await codeOf(computer.operate('chat-1', 'state', 'TextEdit', {}))).toBe('declined');
        // Asking after that is a new question, with a card of its own.
        const asked = computer.operate('chat-1', 'state', 'TextEdit', {});
        await until(() => computer.pendingApprovals().length === 1);
        timers.advance(APPROVAL_WAIT_MS);
        await codeOf(asked);
    });

    test('a card nobody answers goes when its time is up, and a late answer is refused', async () => {
        const { computer, timers } = await computerSetup();
        const call = computer.operate('chat-1', 'state', 'TextEdit', {});
        await until(() => computer.pendingApprovals().length === 1);
        const { requestId } = computer.pendingApprovals()[0]!;
        timers.advance(APPROVAL_WAIT_MS);
        await codeOf(call);
        timers.advance(CARD_MS);
        expect(computer.pendingApprovals()).toEqual([]);
        expect(await computer.answer(requestId, 'once')).toBe(false);
    });

    test('a card of a chat or terminal that stopped running is dropped', async () => {
        const { computer, runs, timers } = await computerSetup();
        const call = computer.operate('term-1', 'state', 'TextEdit', {});
        await until(() => computer.pendingApprovals().length === 1);
        runs.delete('term-1');
        expect(computer.pendingApprovals()).toEqual([]);
        timers.advance(APPROVAL_WAIT_MS);
        await codeOf(call);
    });
});

describe('a terminal', () => {
    test('is refused even with an approval for always, and remembered after it was seen', async () => {
        const { computer, helper } = await computerSetup();
        expect(await codeOf(computer.operate('chat-1', 'state', 'Shells', {}))).toBe('terminal');
        expect(computer.pendingApprovals()).toEqual([]);
        expect(helper.acted).toEqual([]);
        // Without a shell running now it is still the terminal it was.
        helper.apps = [TEXT_EDIT, { ...SHELL_APP, pid: 900 }];
        expect(await codeOf(computer.operate('chat-1', 'key', 'Shells', { combos: ['cmd+n'] }))).toBe('terminal');
    });

    test('is refused before it is launched when it was seen before', async () => {
        const { computer } = await computerSetup();
        await computer.apps('chat-1');
        expect(await codeOf(computer.operate('chat-1', 'open', SHELL_APP.bundleId!, {}))).toBe('terminal');
    });
});

describe('naming an app', () => {
    test('by pid, bundle id or name, the way the helper reads one', () => {
        const apps = [TEXT_EDIT, SHELL_APP, { name: 'Twin', pid: 3 }, { name: 'Twin', pid: 4 }];
        expect(resolveApp('501', apps)).toEqual({ kind: 'running', app: TEXT_EDIT });
        expect(resolveApp('COM.EXAMPLE.TEXTEDIT', apps)).toEqual({ kind: 'running', app: TEXT_EDIT });
        expect(resolveApp('textedit.app', apps)).toEqual({ kind: 'running', app: TEXT_EDIT });
        expect(resolveApp('Twin', apps).kind).toBe('ambiguous');
        expect(resolveApp('Nothing', apps)).toEqual({ kind: 'none' });
    });

    test('refuses an app that does not run, except for open, which finds it by bundle id or file name', async () => {
        const { computer, helper } = await computerSetup();
        expect(await codeOf(computer.operate('chat-1', 'state', 'Notes', {}))).toBe('unknown-app');
        const open = computer.operate('chat-1', 'open', 'Notes', {});
        await until(() => computer.pendingApprovals().length === 1);
        expect(computer.pendingApprovals()[0]!.app).toEqual({ name: 'Notes', bundleId: 'com.example.notes' });
        await computer.answer(computer.pendingApprovals()[0]!.requestId, 'once');
        await open;
        expect(helper.acted.at(-1)).toMatchObject({ command: 'open', app: 'com.example.notes' });
        expect(await codeOf(computer.operate('chat-1', 'open', 'Missing', {}))).toBe('unknown-app');
    });

    test('puts the helper words for its own command line in words for an agent', async () => {
        const { computer, helper } = await computerSetup();
        const call = computer.operate('chat-1', 'state', 'TextEdit', {});
        await until(() => computer.pendingApprovals().length === 1);
        await computer.answer(computer.pendingApprovals()[0]!.requestId, 'once');
        await call;
        helper.error = 'element 3 is no longer at (1, 2); Run `cu state` again';
        expect(await codeOf(computer.operate('chat-1', 'click', 'TextEdit', { element: 3 }))).toBe('app-refused');
        helper.error = 'stopped by the user (Esc). Run `cu state <app>` to continue.';
        expect(await codeOf(computer.operate('chat-1', 'click', 'TextEdit', { element: 3 }))).toBe('stopped');
        helper.error = 'stopped by the person (the stop button). Run `cu state <app>` to continue.';
        expect(await codeOf(computer.operate('chat-1', 'click', 'TextEdit', { element: 3 }))).toBe('stopped');
        expect(agentWords('Run `cu state` again')).toBe('Run `ruimte-context computer state` again');
    });
});
