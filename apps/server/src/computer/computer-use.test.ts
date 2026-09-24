import { describe, expect, test } from 'bun:test';
import type { ComputerAppGrants } from '@ruimte/contracts';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionEvent } from '../sessions/manager.ts';
import { APPROVAL_WAIT_MS, CARD_MS } from './approvals.ts';
import { chatInfo, computerSetup, SHELL_APP, terminalStatus, TEXT_EDIT, turnEnded, until, type ComputerSetup } from './computer-test-helpers.ts';
import { agentWords, findInstalledApp, resolveApp, RUIMTE_SETTLE_MS, SESSION_POLL_MS } from './computer-use.ts';
import { overlayWords } from './overlay-words.ts';

// How long a call held by the person waits before it asks the helper again.
const HOLD_MS = 500;

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

    test('writes every word of the overlay in the language it was turned on in', async () => {
        const read = async (language: string): Promise<Record<string, unknown>> => {
            const { computer, home } = await computerSetup({ enabled: false });
            await computer.setEnabled(true, language);
            return JSON.parse(await readFile(join(home, 'computer-use', 'overlay.json'), 'utf8'));
        };
        const dutch = await read('nl-NL');
        const english = await read('en');
        for (const words of [dutch, english]) {
            expect(Object.keys(words).sort()).toEqual(['menuTitle', 'pause', 'resume', 'steps', 'stop', 'takeOver', 'title']);
            expect(Object.keys(words.steps as object)).toHaveLength(16);
        }
        expect(dutch).toMatchObject({ title: 'Ruimte bedient je computer', pause: 'Pauzeren', stop: 'Sessie stoppen' });
        expect(english).toMatchObject({ title: 'Ruimte is using your computer', menuTitle: 'Ruimte is using this Mac', takeOver: 'Take over' });
        // Every step with a target in one language has it in the other.
        for (const [state, step] of Object.entries(english.steps as Record<string, string>)) {
            expect((dutch.steps as Record<string, string>)[state]!.includes('{target}')).toBe(step.includes('{target}'));
        }
        expect(overlayWords(undefined).title).toBe('Ruimte is using your computer');
        expect(overlayWords('fr').title).toBe('Ruimte is using your computer');
    });

    test('speaks a language a client switched to from then on, only while it is on', async () => {
        const { computer, home } = await computerSetup();
        const overlay = async (): Promise<{ title: string }> => JSON.parse(await readFile(join(home, 'computer-use', 'overlay.json'), 'utf8'));
        await computer.setLanguage('nl');
        expect((await overlay()).title).toBe('Ruimte bedient je computer');
        await computer.setEnabled(false, undefined);
        await computer.setLanguage('en');
        expect((await overlay()).title).toBe('Ruimte bedient je computer');
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

    test('refuses a missing Screen Recording grant too, and names every grant that is missing', async () => {
        const { computer, helper } = await computerSetup();
        helper.screenRecording = false;
        const refusal = await computer.operate('chat-1', 'state', 'TextEdit', {}).catch((error: unknown) => error as { code: string; message: string });
        expect(refusal).toMatchObject({ code: 'not-granted' });
        expect((refusal as { message: string }).message).toContain('the Screen Recording permission');
        helper.accessibility = false;
        expect(((await computer.apps('chat-1').catch((error: unknown) => error)) as { message: string }).message).toContain(
            'the Accessibility and Screen Recording permissions'
        );
        expect(computer.pendingApprovals()).toEqual([]);
    });

    test('is usable, and told to agents, only while it is on and both grants are there', async () => {
        const { computer, helper } = await computerSetup({ enabled: false });
        expect(computer.usable).toBe(false);
        helper.screenRecording = false;
        await computer.setEnabled(true, 'en');
        expect(computer.usable).toBe(false);
        helper.screenRecording = true;
        await computer.refreshStatus();
        expect(computer.usable).toBe(true);
        await computer.setEnabled(false, undefined);
        expect(computer.usable).toBe(false);
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
        expect(events.filter((event) => event.event === 'computer.approvals').at(-1)).toEqual({ event: 'computer.approvals', payload: { approvals: [card!] } });
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

        // The same chat after its conversation started over, and another agent once the Mac is its, are asked again.
        runs.set('chat-1', 'chat:fresh');
        const again = codeOf(computer.operate('chat-1', 'state', 'TextEdit', {}));
        await until(() => computer.pendingApprovals().length === 1);
        await computer.answer(computer.pendingApprovals()[0]!.requestId, 'deny');
        expect(await again).toBe('declined');
        computer.observe(turnEnded('chat-1', 'done'));
        const other = codeOf(computer.operate('term-1', 'state', 'TextEdit', {}));
        await until(() => computer.pendingApprovals().length === 1);
        expect(computer.pendingApprovals()[0]!.surface).toBe('terminal');
        await computer.answer(computer.pendingApprovals()[0]!.requestId, 'deny');
        expect(await other).toBe('declined');
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

/* Raises the card for TextEdit and answers it for this time; the call it held goes through. */
const allowOnce = async (computer: ComputerSetup['computer'], nodeId: string): Promise<void> => {
    const call = computer.operate(nodeId, 'state', 'TextEdit', {});
    await until(() => computer.pendingApprovals().length === 1);
    await computer.answer(computer.pendingApprovals()[0]!.requestId, 'once');
    await call;
};

/* Whether the node is asked again: a card goes up, which the test then lets expire unanswered. */
const asksAgain = async (setup: ComputerSetup, nodeId: string): Promise<boolean> => {
    const acted = setup.helper.acted.length;
    const call = codeOf(setup.computer.operate(nodeId, 'click', 'TextEdit', { element: 1 }));
    await until(() => setup.computer.pendingApprovals().length > 0 || setup.helper.acted.length > acted);
    const asked = setup.computer.pendingApprovals().length > 0;
    setup.timers.advance(APPROVAL_WAIT_MS);
    await call;
    for (const card of setup.computer.pendingApprovals()) {
        await setup.computer.answer(card.requestId, 'deny');
    }
    // The no of that answer reaches the agent on its next call; take it here so the test starts clean.
    if (asked) {
        await codeOf(setup.computer.operate(nodeId, 'click', 'TextEdit', { element: 1 }));
    }
    return asked;
};

describe('"this time"', () => {
    test('lasts until the turn of a chat ends', async () => {
        const setup = await computerSetup();
        setup.computer.observe(chatInfo('chat-1', 'running'));
        await allowOnce(setup.computer, 'chat-1');
        expect(await asksAgain(setup, 'chat-1')).toBe(false);
        setup.computer.observe(turnEnded('chat-1', 'done'));
        expect(await asksAgain(setup, 'chat-1')).toBe(true);
    });

    test('lasts while a terminal agent waits on the person, and ends when it goes idle', async () => {
        const setup = await computerSetup();
        setup.computer.observe(terminalStatus('term-1', 'running'));
        await allowOnce(setup.computer, 'term-1');
        setup.computer.observe(terminalStatus('term-1', 'needs-you'));
        setup.computer.observe(terminalStatus('term-1', 'running'));
        expect(await asksAgain(setup, 'term-1')).toBe(false);
        setup.computer.observe(terminalStatus('term-1', 'idle'));
        expect(await asksAgain(setup, 'term-1')).toBe(true);
    });

    test('given between turns lasts through the next one', async () => {
        const setup = await computerSetup();
        setup.computer.observe(chatInfo('chat-1', 'running'));
        setup.computer.observe(chatInfo('chat-1', 'idle'));
        await allowOnce(setup.computer, 'chat-1');
        setup.computer.observe(chatInfo('chat-1', 'idle'));
        setup.computer.observe(chatInfo('chat-1', 'running'));
        expect(await asksAgain(setup, 'chat-1')).toBe(false);
        setup.computer.observe(chatInfo('chat-1', 'idle'));
        expect(await asksAgain(setup, 'chat-1')).toBe(true);
    });

    test('goes when computer use is turned off', async () => {
        const setup = await computerSetup();
        await allowOnce(setup.computer, 'chat-1');
        await setup.computer.setEnabled(false, undefined);
        await setup.computer.setEnabled(true, 'en');
        expect(await asksAgain(setup, 'chat-1')).toBe(true);
    });
});

describe('a card whose agent is gone', () => {
    test('goes at once when a terminal agent exits or a node closes', async () => {
        const { computer } = await computerSetup();
        const published: number[] = [];
        computer.subscribe('client-1', (event) => {
            if (event.event === 'computer.approvals') {
                published.push(event.payload.approvals.length);
            }
        });
        const terminal = codeOf(computer.operate('term-1', 'state', 'TextEdit', {}));
        await until(() => computer.pendingApprovals().length === 1);
        computer.observe(terminalStatus('term-1', 'exited'));
        expect(await terminal).toBe('declined');
        expect(published.at(-1)).toBe(0);

        const chat = codeOf(computer.operate('chat-1', 'state', 'TextEdit', {}));
        await until(() => computer.pendingApprovals().length === 1);
        computer.nodeClosed('chat-1');
        expect(await chat).toBe('declined');
        expect(published.at(-1)).toBe(0);
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

    test('launched by open is refused before its tree goes back, and known from then on', async () => {
        const { computer, helper } = await computerSetup({
            overrides: { findApp: async (name) => (name === 'Shells' ? { name: 'Shells', bundleId: SHELL_APP.bundleId! } : null) }
        });
        helper.apps = [TEXT_EDIT];
        helper.launchable = SHELL_APP;
        const open = codeOf(computer.operate('chat-1', 'open', 'Shells', { withState: true }));
        await until(() => computer.pendingApprovals().length === 1);
        await computer.answer(computer.pendingApprovals()[0]!.requestId, 'once');
        expect(await open).toBe('terminal');
        expect((await computer.apps('chat-1')).apps.find(({ app }) => app.name === 'Shells')?.access).toBe('terminal');
    });

    test('is never Ruimte, whose shells sit under the daemon, and which asks like any other app', async () => {
        const ruimte = { name: 'Ruimte', pid: 600, bundleId: 'app.ruimte.desktop.dev' };
        const { computer, helper } = await computerSetup({
            overrides: {
                processes: async () => [
                    { pid: 600, ppid: 1, tty: null },
                    { pid: 601, ppid: 600, tty: null },
                    { pid: 602, ppid: 601, tty: 'ttys009' }
                ]
            }
        });
        helper.apps = [TEXT_EDIT, ruimte];
        expect((await computer.apps('chat-1')).apps.map(({ access }) => access)).toEqual(['ask', 'ask']);
    });

    test('is refused before it is launched when it was seen before', async () => {
        const { computer } = await computerSetup();
        await computer.apps('chat-1');
        expect(await codeOf(computer.operate('chat-1', 'open', SHELL_APP.bundleId!, {}))).toBe('terminal');
    });
});

describe('taking a grant back', () => {
    const grantEvents = (computer: ComputerSetup['computer']): ComputerAppGrants[] => {
        const events: ComputerAppGrants[] = [];
        computer.subscribe('client-1', (event) => {
            if (event.event === 'computer.grants') {
                events.push(event.payload);
            }
        });
        return events;
    };

    test('"always" is listed and taken back, and every client hears each change', async () => {
        const setup = await computerSetup();
        const { computer, timers } = setup;
        const events = grantEvents(computer);
        const call = computer.operate('chat-1', 'state', 'TextEdit', {});
        await until(() => computer.pendingApprovals().length === 1);
        await computer.answer(computer.pendingApprovals()[0]!.requestId, 'always');
        await call;
        const always = [{ bundleId: TEXT_EDIT.bundleId!, name: 'TextEdit', at: timers.now }];
        expect(computer.grants()).toEqual({ always, terminals: [], thisTime: [] });
        expect(events.at(-1)?.always).toEqual(always);

        expect(await computer.revoke(TEXT_EDIT.bundleId!, 'always')).toBe(true);
        expect(events.at(-1)?.always).toEqual([]);
        const heard = events.length;
        expect(await computer.revoke(TEXT_EDIT.bundleId!, 'always')).toBe(false);
        expect(events).toHaveLength(heard);
        expect(await asksAgain(setup, 'chat-1')).toBe(true);
    });

    test('an app that is no terminal is asked about again, until it runs a shell again', async () => {
        const { computer, helper } = await computerSetup();
        const events = grantEvents(computer);
        expect(await codeOf(computer.operate('chat-1', 'state', 'Shells', {}))).toBe('terminal');
        expect(events.at(-1)?.terminals.map((entry) => entry.bundleId)).toEqual([SHELL_APP.bundleId!]);

        expect(await computer.revoke(SHELL_APP.bundleId!, 'terminal')).toBe(true);
        expect(events.at(-1)?.terminals).toEqual([]);
        helper.apps = [TEXT_EDIT, { ...SHELL_APP, pid: 900 }];
        expect((await computer.apps('chat-1')).apps.find(({ app }) => app.name === 'Shells')?.access).toBe('ask');
        helper.apps = [TEXT_EDIT, SHELL_APP];
        expect((await computer.apps('chat-1')).apps.find(({ app }) => app.name === 'Shells')?.access).toBe('terminal');
        expect(computer.grants().terminals).toHaveLength(1);
    });

    test('"this time" is listed with its node, taken from that agent alone, and gone with the turn', async () => {
        const setup = await computerSetup();
        const { computer, timers } = setup;
        const events = grantEvents(computer);
        computer.observe(chatInfo('chat-1', 'running'));
        await allowOnce(computer, 'chat-1');
        expect(computer.grants().thisTime).toEqual([
            { bundleId: TEXT_EDIT.bundleId!, name: 'TextEdit', at: timers.now, nodeId: 'chat-1', nodeTitle: 'Node chat-1', projectName: 'Ruimte' }
        ]);
        expect(events.at(-1)?.thisTime).toHaveLength(1);

        expect(await computer.revoke(TEXT_EDIT.bundleId!, 'thisTime', 'term-1')).toBe(false);
        expect(await computer.revoke(TEXT_EDIT.bundleId!, 'thisTime', 'chat-1')).toBe(true);
        expect(events.at(-1)?.thisTime).toEqual([]);
        expect(await asksAgain(setup, 'chat-1')).toBe(true);

        await allowOnce(computer, 'chat-1');
        expect(events.at(-1)?.thisTime).toHaveLength(1);
        computer.observe(turnEnded('chat-1', 'done'));
        expect(events.at(-1)?.thisTime).toEqual([]);
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

    test('by the file name of its bundle where macOS shows the name localized', () => {
        const calculator = { name: 'Rekenmachine', pid: 42, bundleId: 'com.apple.calculator', bundleName: 'Calculator' };
        expect(resolveApp('Calculator', [TEXT_EDIT, calculator])).toEqual({ kind: 'running', app: calculator });
        expect(resolveApp('calculator.app', [TEXT_EDIT, calculator])).toEqual({ kind: 'running', app: calculator });
        expect(resolveApp('Rekenmachine', [TEXT_EDIT, calculator])).toEqual({ kind: 'running', app: calculator });
    });

    test('that does not run, by the file name of its bundle or the name it shows', async () => {
        const folder = await mkdtemp(join(tmpdir(), 'ruimte-apps-'));
        await mkdir(join(folder, 'Calculator.app'));
        await mkdir(join(folder, 'zoom.us.app'));
        const plists: Record<string, Record<string, string>> = {
            [join(folder, 'Calculator.app', 'Contents', 'Info.plist')]: { CFBundleIdentifier: 'com.apple.calculator', CFBundleDisplayName: 'Calculator' },
            [join(folder, 'zoom.us.app', 'Contents', 'Info.plist')]: { CFBundleIdentifier: 'us.zoom.xos', CFBundleDisplayName: 'Zoom' }
        };
        const sources = { folders: [folder], read: async (plist: string, key: string) => plists[plist]?.[key] ?? null };
        expect(await findInstalledApp('calculator.app', sources)).toEqual({ name: 'Calculator', bundleId: 'com.apple.calculator' });
        expect(await findInstalledApp('Zoom', sources)).toEqual({ name: 'zoom.us', bundleId: 'us.zoom.xos' });
        expect(await findInstalledApp('zoom.us', sources)).toEqual({ name: 'zoom.us', bundleId: 'us.zoom.xos' });
        expect(await findInstalledApp('Missing', sources)).toBeNull();
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
        // For always: a stop takes back what was allowed this time.
        await computer.answer(computer.pendingApprovals()[0]!.requestId, 'always');
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

/* Lets chat-1 into TextEdit for always, and forgets what that showed. */
const letIn = async (setup: ComputerSetup): Promise<void> => {
    const call = setup.computer.operate('chat-1', 'state', 'TextEdit', {});
    await until(() => setup.computer.pendingApprovals().length === 1);
    await setup.computer.answer(setup.computer.pendingApprovals()[0]!.requestId, 'always');
    await call;
    await until(() => setup.helper.presences.at(-1) === 'think');
    setup.helper.requests.length = 0;
};

describe('the presence at the cursor', () => {
    test('asks for permission with the app, then works between actions and waits on the person', async () => {
        const setup = await computerSetup();
        const { computer, helper } = setup;
        const call = computer.operate('chat-1', 'state', 'TextEdit', {});
        await until(() => helper.presences.length === 1);
        expect(helper.presences).toEqual(['permission: Waiting for permission for TextEdit']);
        await computer.answer(computer.pendingApprovals()[0]!.requestId, 'once');
        await call;
        await until(() => helper.presences.length === 2);
        computer.observe(chatInfo('chat-1', 'needs-you'));
        await until(() => helper.presences.length === 3);
        computer.observe(chatInfo('chat-1', 'running'));
        await until(() => helper.presences.length === 4);
        computer.observe(turnEnded('chat-1', 'done'));
        computer.observe(chatInfo('chat-1', 'idle'));
        await until(() => helper.presences.length === 5);
        expect(helper.presences).toEqual(['permission: Waiting for permission for TextEdit', 'think', 'waiting', 'think', 'done']);
        expect(helper.presences.every((presence) => !presence.startsWith('undefined'))).toBe(true);
    });

    test('ends the session when a chat is interrupted or a terminal goes, and ignores whoever does not hold it', async () => {
        const setup = await computerSetup();
        const { computer, helper } = setup;
        await letIn(setup);
        computer.observe(terminalStatus('term-1', 'needs-you'));
        computer.observe(chatInfo('chat-2', 'idle'));
        computer.observe(turnEnded('chat-1', 'aborted'));
        await until(() => helper.presences.length === 1);
        expect(helper.presences).toEqual(['end']);
        await until(() => computer.status().session === null);

        await computer.operate('term-1', 'state', 'TextEdit', {});
        computer.observe(terminalStatus('term-1', 'running'));
        await until(() => helper.presences.at(-1) === 'think');
        computer.observe({ event: 'session.exit', payload: { sessionId: 'term-1' } } as unknown as SessionEvent);
        await until(() => helper.presences.at(-1) === 'end');
        const shown = helper.presences.length;
        computer.observe(terminalStatus('term-1', 'running'));
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(helper.presences).toHaveLength(shown);
        expect(computer.status().session).toBeNull();
    });

    test('ends a session the person paused as well, once the turn is interrupted', async () => {
        const setup = await computerSetup();
        const { computer, helper } = setup;
        await letIn(setup);
        await computer.control('pause');
        computer.observe(turnEnded('chat-1', 'aborted'));
        await until(() => computer.status().session === null);
        expect(helper.presences).toEqual(['end']);
        expect(helper.session.active).toBe(false);
    });

    test('shows no error for an action the helper refused, which the agent recovers from itself', async () => {
        const setup = await computerSetup();
        const { computer, helper } = setup;
        await letIn(setup);
        helper.error = 'element 3 is gone or has no frame any more; run `cu state` again';
        expect(await codeOf(computer.operate('chat-1', 'click', 'TextEdit', { element: 3 }))).toBe('app-refused');
        await until(() => helper.presences.length === 1);
        expect(helper.presences).toEqual(['think']);
    });

    test('shows why the session ends when the agent stops with an error, and ends it', async () => {
        const setup = await computerSetup();
        const { computer, helper } = setup;
        await letIn(setup);
        computer.observe(turnEnded('chat-1', 'error'));
        await until(() => computer.status().session === null);
        expect(helper.presences).toEqual(['error: The agent stopped with an error']);
        expect(helper.requests.at(-1)).toMatchObject({ command: 'presence', state: 'error', ends: true });
        expect(helper.session.active).toBe(false);
    });

    test('a presence the helper refuses is logged and the action never waits on it', async () => {
        const logs: string[] = [];
        const setup = await computerSetup({ overrides: { log: (message) => logs.push(message) } });
        await letIn(setup);
        setup.helper.stop();
        setup.computer.observe(chatInfo('chat-1', 'needs-you'));
        await until(() => logs.length === 1);
        expect(logs[0]).toStartWith('Showing waiting at the computer use cursor failed: stopped by the person');
    });
});

describe('the person holding the Mac', () => {
    test('holds a call while paused and runs it once they resume', async () => {
        const setup = await computerSetup();
        const { computer, helper, timers } = setup;
        await letIn(setup);
        helper.hold('paused');
        const call = computer.operate('chat-1', 'click', 'TextEdit', { element: 1 });
        await until(() => timers.waitingFor(HOLD_MS) > 0);
        expect(computer.status().session).toEqual({ mode: 'paused', nodeId: 'chat-1' });
        timers.advance(500);
        await until(() => timers.waitingFor(HOLD_MS) > 0);
        helper.hold('running');
        timers.advance(500);
        await call;
        expect(helper.acted.map((request) => request.command)).toEqual(['click']);
        expect(computer.status().session).toEqual({ mode: 'running', nodeId: 'chat-1' });
    });

    test('refuses with paused or taken-over once the hold is spent, and asks nothing of the app', async () => {
        const setup = await computerSetup();
        const { computer, helper, timers } = setup;
        await letIn(setup);
        for (const [mode, code] of [
            ['paused', 'paused'],
            ['takenOver', 'taken-over']
        ] as const) {
            helper.hold(mode);
            const call = codeOf(computer.operate('chat-1', 'click', 'TextEdit', { element: 1 }));
            for (let waited = 0; waited < APPROVAL_WAIT_MS; waited += 500) {
                await until(() => timers.waitingFor(HOLD_MS) > 0);
                timers.advance(500);
            }
            expect(await call).toBe(code);
            expect(computer.status().session?.mode).toBe(mode);
        }
        expect(helper.acted).toEqual([]);
    });

    test('an action the person cut off is refused and never sent again, even when they resume', async () => {
        const setup = await computerSetup();
        const { computer, helper, timers } = setup;
        await letIn(setup);
        helper.onAct = () => {
            helper.onAct = null;
            helper.hold('takenOver');
        };
        const call = computer.operate('chat-1', 'type', 'TextEdit', { text: 'hello' }).catch((error: unknown) => error as { code: string; message: string });
        await until(() => timers.waitingFor(HOLD_MS) > 0);
        helper.hold('running');
        timers.advance(500);
        const refusal = await call;
        expect(refusal).toMatchObject({ code: 'taken-over' });
        expect((refusal as { message: string }).message).toContain('which holds until they hand it back');
        expect(helper.acted.map((request) => request.command)).toEqual(['type']);
    });

    test('a stop refuses with stopped, ends the session and lets a new state pick up', async () => {
        const setup = await computerSetup();
        const { computer, helper } = setup;
        await letIn(setup);
        helper.stop();
        expect(await codeOf(computer.operate('chat-1', 'click', 'TextEdit', { element: 1 }))).toBe('stopped');
        expect(computer.status().session).toBeNull();
        // Nobody holds the session after a stop, so nothing is shown for the chat any more.
        computer.observe(chatInfo('chat-1', 'needs-you'));
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(helper.presences).toEqual([]);
        await computer.operate('chat-1', 'state', 'TextEdit', {});
        expect(computer.status().session).toEqual({ mode: 'running', nodeId: 'chat-1' });
    });
});

describe('the hold an agent asks for', () => {
    test('keeps the card up for that long instead of the default, and goes on as soon as the person answers', async () => {
        const { computer, helper, timers } = await computerSetup();
        const call = computer.operate('chat-1', 'state', 'TextEdit', {}, 60_000);
        await until(() => computer.pendingApprovals().length === 1);
        expect(timers.waitingFor(60_000)).toBe(1);
        timers.advance(45_000);
        await computer.answer(computer.pendingApprovals()[0]!.requestId, 'once');
        await call;
        expect(helper.acted.map((request) => request.command)).toEqual(['state']);
    });

    test('is one budget for the card and the pause together', async () => {
        const setup = await computerSetup();
        const { computer, helper, timers } = setup;
        helper.hold('paused');
        const call = codeOf(computer.operate('chat-1', 'click', 'TextEdit', { element: 1 }, 20_000));
        await until(() => computer.pendingApprovals().length === 1);
        timers.advance(15_000);
        await computer.answer(computer.pendingApprovals()[0]!.requestId, 'once');
        for (let waited = 0; waited < 5_000; waited += HOLD_MS) {
            await until(() => timers.waitingFor(HOLD_MS) > 0);
            timers.advance(HOLD_MS);
        }
        expect(await call).toBe('paused');
        expect(helper.acted).toEqual([]);
    });
});

describe('the trees an agent got', () => {
    test('are told against per agent and app, and forgotten with the node', async () => {
        const setup = await computerSetup();
        const { computer } = setup;
        await letIn(setup);
        const state = await computer.operate('chat-1', 'state', 'TextEdit', {});
        expect(computer.treeView('chat-1', state, 'full')).toEqual({ kind: 'full', reason: null });
        expect(computer.treeView('chat-1', state, 'diff')).toMatchObject({ kind: 'diff', added: 0, gone: 0, changed: 0 });
        expect(computer.treeView('term-1', state, 'diff')).toMatchObject({ kind: 'full', reason: 'the first state of this app you got' });
        computer.nodeClosed('chat-1');
        expect(computer.treeView('chat-1', state, 'diff')).toMatchObject({ kind: 'full' });
    });
});

describe('a stop by the person', () => {
    test('reaches the agent that held the session on its next call, state included, once', async () => {
        const setup = await computerSetup();
        const { computer, helper } = setup;
        await letIn(setup);
        // From the bar or a key while the agent thinks: the machine hears of it only when it next asks.
        helper.stop();
        expect(await codeOf(computer.operate('chat-1', 'state', 'TextEdit', {}))).toBe('stopped');
        expect(helper.session.stopped).toBe(false);
        expect((await computer.operate('chat-1', 'state', 'TextEdit', {})).tree).toHaveLength(2);
    });

    test('takes back what was allowed this time', async () => {
        const { computer, timers } = await computerSetup();
        const call = computer.operate('chat-1', 'state', 'TextEdit', {});
        await until(() => computer.pendingApprovals().length === 1);
        await computer.answer(computer.pendingApprovals()[0]!.requestId, 'once');
        await call;
        await computer.control('stop');
        expect(await codeOf(computer.operate('chat-1', 'click', 'TextEdit', { element: 1 }))).toBe('stopped');
        const again = codeOf(computer.operate('chat-1', 'click', 'TextEdit', { element: 1 }));
        await until(() => computer.pendingApprovals().length === 1);
        timers.advance(APPROVAL_WAIT_MS);
        expect(await again).toBe('awaiting-approval');
    });
});

const NOTES = { name: 'Notes', pid: 502, bundleId: 'com.example.notes' };

const refusalOf = (work: Promise<unknown>): Promise<{ code: string; message: string } | null> =>
    work.then(
        () => null,
        (error: unknown) => error as { code: string; message: string }
    );

/* Lets the call run until it stands in line for the Mac. */
const inLine = async (computer: ComputerSetup['computer'], count: number): Promise<void> => {
    await until(() => (computer.status().waiting ?? []).length === count);
};

describe('one agent at a time', () => {
    test('refuses another agent busy at once, naming the node that holds the Mac', async () => {
        const setup = await computerSetup();
        const { computer, helper } = setup;
        await letIn(setup);
        const refusal = await refusalOf(computer.operate('term-1', 'click', 'TextEdit', { element: 1 }));
        expect(refusal?.code).toBe('busy');
        expect(refusal?.message).toContain('Node chat-1');
        expect(refusal?.message).toContain('--wait 60');
        expect(helper.acted).toEqual([]);
        await computer.operate('chat-1', 'click', 'TextEdit', { element: 1 });
        expect(helper.acted.map((request) => request.command)).toEqual(['click']);
    });

    test("holds a call with --wait until the holder's turn ends, and refuses busy once the wait is spent", async () => {
        const setup = await computerSetup();
        const { computer, helper, timers } = setup;
        await letIn(setup);
        const spent = codeOf(computer.operate('term-1', 'click', 'TextEdit', { element: 1 }, 10_000));
        await inLine(computer, 1);
        timers.advance(10_000);
        expect(await spent).toBe('busy');
        expect(computer.status().waiting).toBeUndefined();

        const call = computer.operate('term-1', 'click', 'TextEdit', { element: 1 }, 60_000);
        await inLine(computer, 1);
        expect(computer.status().waiting).toEqual(['term-1']);
        timers.advance(30_000);
        expect(helper.acted).toEqual([]);
        computer.observe(turnEnded('chat-1', 'done'));
        await call;
        expect(helper.acted.map((request) => request.command)).toEqual(['click']);
        expect(computer.holder).toBe('term-1');
        expect(computer.status().waiting).toBeUndefined();
    });

    test('hands the Mac to the agents in line in the order they asked', async () => {
        const setup = await computerSetup();
        const { computer, helper, runs } = setup;
        runs.set('chat-2', 'chat:c');
        await letIn(setup);
        const order: string[] = [];
        const second = computer.operate('term-1', 'click', 'TextEdit', { element: 1 }, 60_000).then(() => order.push('term-1'));
        await inLine(computer, 1);
        const third = computer.operate('chat-2', 'click', 'TextEdit', { element: 2 }, 60_000).then(() => order.push('chat-2'));
        await inLine(computer, 2);
        expect(computer.status().waiting).toEqual(['term-1', 'chat-2']);
        // The chat whose turn ended asks again, and goes to the back of the line.
        computer.observe(turnEnded('chat-1', 'done'));
        const last = computer.operate('chat-1', 'click', 'TextEdit', { element: 3 }, 60_000).then(() => order.push('chat-1'));
        await second;
        await inLine(computer, 2);
        expect(computer.status().waiting).toEqual(['chat-2', 'chat-1']);
        computer.observe(terminalStatus('term-1', 'running'));
        computer.observe(terminalStatus('term-1', 'idle'));
        await third;
        computer.observe(turnEnded('chat-2', 'done'));
        await last;
        expect(order).toEqual(['term-1', 'chat-2', 'chat-1']);
        expect(helper.acted.map((request) => request.element)).toEqual([1, 2, 3]);
    });

    test('shows the card of an agent in line, whose answer does not hand it the Mac', async () => {
        const setup = await computerSetup();
        const { computer, helper } = setup;
        await letIn(setup);
        helper.apps = [...helper.apps, NOTES];
        const call = computer.operate('term-1', 'state', 'Notes', {}, 60_000);
        await inLine(computer, 1);
        await until(() => computer.pendingApprovals().length === 1);
        expect(computer.pendingApprovals()[0]).toMatchObject({ nodeId: 'term-1', app: { name: 'Notes' } });
        await computer.answer(computer.pendingApprovals()[0]!.requestId, 'once');
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(computer.holder).toBe('chat-1');
        expect(computer.status().waiting).toEqual(['term-1']);
        // The cursor still speaks for the holder: no permission for the agent in line.
        expect(helper.presences).toEqual([]);
        expect(helper.acted).toEqual([]);
        computer.observe(turnEnded('chat-1', 'done'));
        await call;
        expect(helper.acted.at(-1)).toMatchObject({ command: 'state', app: '502' });
        expect(computer.pendingApprovals()).toEqual([]);
    });

    test('keeps apps open to every agent', async () => {
        const setup = await computerSetup();
        const { computer } = setup;
        await letIn(setup);
        expect((await computer.apps('term-1')).apps.map(({ access }) => access)).toEqual(['always', 'terminal']);
        expect(computer.holder).toBe('chat-1');
    });

    test("is let go when the holder's node closes, and a node in line that closes leaves it", async () => {
        const setup = await computerSetup();
        const { computer, runs } = setup;
        runs.set('chat-2', 'chat:c');
        await letIn(setup);
        const call = computer.operate('term-1', 'click', 'TextEdit', { element: 1 }, 60_000);
        await inLine(computer, 1);
        computer.nodeClosed('chat-1');
        await call;
        expect(computer.holder).toBe('term-1');
        const waiter = codeOf(computer.operate('chat-2', 'click', 'TextEdit', { element: 1 }, 60_000));
        await inLine(computer, 1);
        computer.nodeClosed('chat-2');
        expect(await waiter).toBe('not-in-session');
        expect(computer.holder).toBe('term-1');
    });

    test('is let go when the helper ends a quiet session by itself', async () => {
        const setup = await computerSetup();
        const { computer, helper, timers } = setup;
        await letIn(setup);
        helper.session = { active: false, mode: 'running', stopped: false };
        timers.advance(SESSION_POLL_MS);
        await until(() => computer.holder === null);
        await computer.operate('term-1', 'click', 'TextEdit', { element: 1 });
        expect(computer.holder).toBe('term-1');
    });

    test('is let go when computer use is turned off, and a call in line hears so', async () => {
        const setup = await computerSetup();
        const { computer } = setup;
        await letIn(setup);
        const waiter = codeOf(computer.operate('term-1', 'click', 'TextEdit', { element: 1 }, 60_000));
        await inLine(computer, 1);
        await computer.setEnabled(false, undefined);
        expect(await waiter).toBe('computer-use-off');
        expect(computer.holder).toBeNull();
    });

    test('never lets a call reach the helper once its turn ended while it waited and another took the Mac', async () => {
        const setup = await computerSetup();
        const { computer, helper } = setup;
        await letIn(setup);
        helper.apps = [...helper.apps, NOTES];
        const call = codeOf(computer.operate('chat-1', 'state', 'Notes', {}, 60_000));
        await until(() => computer.pendingApprovals().length === 1);
        computer.observe(turnEnded('chat-1', 'aborted'));
        await computer.operate('term-1', 'click', 'TextEdit', { element: 1 });
        await computer.answer(computer.pendingApprovals()[0]!.requestId, 'once');
        expect(await call).toBe('busy');
        expect(helper.acted.map((request) => request.command)).toEqual(['click']);
    });
});

describe('a stop by the person, for every agent', () => {
    test('reaches every agent that called since computer use was turned on, once each, and bans none', async () => {
        const setup = await computerSetup();
        const { computer, runs } = setup;
        runs.set('chat-2', 'chat:c');
        await letIn(setup);
        expect(await codeOf(computer.operate('term-1', 'click', 'TextEdit', { element: 1 }))).toBe('busy');
        await computer.apps('chat-2');
        await computer.control('stop');
        for (const nodeId of ['chat-1', 'term-1', 'chat-2']) {
            expect(await codeOf(computer.apps(nodeId))).toBe('stopped');
        }
        // A stop is no ban: the first to take the Mac again holds it.
        expect((await computer.apps('term-1')).apps).toHaveLength(2);
        await computer.operate('term-1', 'state', 'TextEdit', {});
        expect(computer.holder).toBe('term-1');
        expect(await codeOf(computer.operate('chat-1', 'state', 'TextEdit', {}))).toBe('busy');
        // An agent that never called before the stop hears nothing of it.
        runs.set('chat-3', 'chat:d');
        expect((await computer.apps('chat-3')).apps).toHaveLength(2);
    });

    test('refuses a call in line at once', async () => {
        const setup = await computerSetup();
        const { computer } = setup;
        await letIn(setup);
        const waiter = codeOf(computer.operate('term-1', 'click', 'TextEdit', { element: 1 }, 60_000));
        await inLine(computer, 1);
        await computer.control('stop');
        expect(await waiter).toBe('stopped');
        expect(computer.status().waiting).toBeUndefined();
        await computer.operate('term-1', 'state', 'TextEdit', {});
        expect(computer.holder).toBe('term-1');
    });
});

describe('the status of the session', () => {
    test('says whether a session runs, its mode and which node holds it', async () => {
        const setup = await computerSetup();
        const { computer, helper } = setup;
        const events: SessionEvent[] = [];
        computer.subscribe('client-1', (event) => events.push(event));
        expect(computer.status().session).toBeNull();
        await letIn(setup);
        expect(computer.status().session).toEqual({ mode: 'running', nodeId: 'chat-1' });
        helper.hold('paused');
        await computer.refreshStatus();
        expect(computer.status().session).toEqual({ mode: 'paused', nodeId: 'chat-1' });
        helper.hold('running');
        computer.observe(turnEnded('chat-1', 'done'));
        await until(() => computer.status().session === null);
        const sessions = events.flatMap((event) => (event.event === 'computer.status' ? [event.payload.session] : []));
        expect(sessions).toContainEqual({ mode: 'paused', nodeId: 'chat-1' });
        expect(sessions.at(-1)).toBeNull();
    });
});

describe('watching a session that runs', () => {
    test('shows a pause, a stop or the helper ending it by itself without a call, and stops asking once none runs', async () => {
        const setup = await computerSetup();
        const { computer, helper, timers } = setup;
        await letIn(setup);
        expect(timers.waitingFor(SESSION_POLL_MS)).toBe(1);
        helper.hold('paused');
        timers.advance(SESSION_POLL_MS);
        await until(() => computer.status().session?.mode === 'paused');
        helper.hold('running');
        timers.advance(SESSION_POLL_MS);
        await until(() => computer.status().session?.mode === 'running');
        // The helper's own end after two quiet minutes.
        helper.session = { active: false, mode: 'running', stopped: false };
        timers.advance(SESSION_POLL_MS);
        await until(() => computer.status().session === null);
        expect(timers.waitingFor(SESSION_POLL_MS)).toBe(0);
        const asked = helper.requests.length;
        timers.advance(SESSION_POLL_MS * 3);
        expect(helper.requests).toHaveLength(asked);
    });

    test('hears a stop from the bar, which the agent then hears on its next call', async () => {
        const setup = await computerSetup();
        const { computer, helper, timers } = setup;
        await letIn(setup);
        helper.stop();
        timers.advance(SESSION_POLL_MS);
        await until(() => computer.status().session === null && !helper.session.stopped);
        expect(await codeOf(computer.operate('chat-1', 'state', 'TextEdit', {}))).toBe('stopped');
    });
});

describe('a fresh helper for a new grant', () => {
    test('quits the helper, waits until it stops answering, and starts one that reads the grants anew', async () => {
        const { computer, helper, launches } = await computerSetup();
        helper.screenRecording = false;
        await computer.refreshStatus();
        expect(computer.status().screenRecording).toBe(false);
        helper.lingerAfterQuit = 2;
        helper.screenRecording = true;
        const before = launches.length;
        const status = await computer.restart();
        expect(launches.length).toBe(before + 1);
        expect(status).toMatchObject({ enabled: true, running: true, screenRecording: true });
        expect(helper.requests.map((request) => request.command).indexOf('quit')).toBeGreaterThanOrEqual(0);
    });

    test('starts nothing while computer use is off', async () => {
        const { computer, helper, launches } = await computerSetup({ enabled: false });
        helper.running = false;
        expect(await computer.restart()).toMatchObject({ enabled: false, running: false });
        expect(launches).toEqual([]);
    });
});

describe('asking macOS for a grant', () => {
    test('has the helper ask for that one grant, starting it when it does not run', async () => {
        const { computer, helper, launches } = await computerSetup();
        helper.running = false;
        helper.screenRecording = false;
        const before = launches.length;
        expect(await computer.requestGrant('screenRecording')).toMatchObject({ running: true, screenRecording: false });
        expect(launches.length).toBe(before + 1);
        expect(helper.requests.at(-1)).toMatchObject({ command: 'doctor', prompt: true, grant: 'screenRecording' });
    });

    test('asks nothing while computer use is off', async () => {
        const { computer, helper } = await computerSetup({ enabled: false });
        await computer.requestGrant('accessibility');
        expect(helper.requests.some((request) => request.prompt === true)).toBe(false);
    });
});

describe("the person's buttons in Ruimte", () => {
    test('pause and resume the session the way the session bar does', async () => {
        const setup = await computerSetup();
        const { computer, helper } = setup;
        await letIn(setup);
        expect((await computer.control('pause')).session).toEqual({ mode: 'paused', nodeId: 'chat-1' });
        expect(helper.session.mode).toBe('paused');
        // A second pause is no resume.
        expect((await computer.control('pause')).session).toEqual({ mode: 'paused', nodeId: 'chat-1' });
        expect((await computer.control('resume')).session).toEqual({ mode: 'running', nodeId: 'chat-1' });
    });

    test('a stop ends the session, and the agent hears stopped on its next call', async () => {
        const setup = await computerSetup();
        const { computer, helper } = setup;
        await letIn(setup);
        expect((await computer.control('stop')).session).toBeNull();
        computer.observe(chatInfo('chat-1', 'needs-you'));
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(helper.presences).toEqual([]);
        expect(await codeOf(computer.operate('chat-1', 'click', 'TextEdit', { element: 1 }))).toBe('stopped');
    });

    test('start no helper and change nothing when none runs', async () => {
        const { computer, helper, launches } = await computerSetup();
        helper.running = false;
        const before = launches.length;
        expect((await computer.control('stop')).session).toBeNull();
        expect(launches.length).toBe(before);
    });
});

const RUIMTE = { name: 'Ruimte', pid: 600, bundleId: 'app.ruimte.desktop' };

/* Lets chat-1 into Ruimte for always with a click, and notes whether Ruimte counted as operated while the helper acted. */
const clickRuimte = async (setup: ComputerSetup): Promise<{ duringAction: boolean }> => {
    setup.helper.apps = [...setup.helper.apps, RUIMTE];
    let duringAction = false;
    setup.helper.onAct = () => {
        duringAction = setup.computer.operatingRuimte();
    };
    const call = setup.computer.operate('chat-1', 'click', 'Ruimte', { element: 1 });
    await until(() => setup.computer.pendingApprovals().length === 1);
    await setup.computer.answer(setup.computer.pendingApprovals()[0]!.requestId, 'always');
    await call;
    setup.helper.onAct = null;
    return { duringAction };
};

describe('an agent operating Ruimte', () => {
    test('starts with an action on Ruimte, before the helper acts, and says so in the status', async () => {
        const setup = await computerSetup();
        expect(setup.computer.operatingRuimte()).toBe(false);
        const { duringAction } = await clickRuimte(setup);
        expect(duringAction).toBe(true);
        expect(setup.computer.operatingRuimte()).toBe(true);
        expect(setup.computer.status().session).toEqual({ mode: 'running', nodeId: 'chat-1', operatingRuimte: true });
    });

    test('holds for the dev build too, and never for another app alone', async () => {
        const setup = await computerSetup();
        await letIn(setup);
        await setup.computer.operate('chat-1', 'click', 'TextEdit', { element: 1 });
        expect(setup.computer.operatingRuimte()).toBe(false);
        expect(setup.computer.status().session).toEqual({ mode: 'running', nodeId: 'chat-1' });
        setup.helper.apps = [...setup.helper.apps, { name: 'Ruimte Dev', pid: 601, bundleId: 'app.ruimte.desktop.dev' }];
        const call = setup.computer.operate('chat-1', 'state', 'Ruimte Dev', {});
        await until(() => setup.computer.pendingApprovals().length === 1);
        await setup.computer.answer(setup.computer.pendingApprovals()[0]!.requestId, 'once');
        await call;
        expect(setup.computer.operatingRuimte()).toBe(true);
    });

    test('ends while the person pauses or takes over, and holds again once they resume', async () => {
        const setup = await computerSetup();
        const { computer, helper, timers } = setup;
        await clickRuimte(setup);
        for (const mode of ['paused', 'takenOver'] as const) {
            helper.hold(mode);
            expect(await computer.confirmOperatingRuimte()).toBe(false);
            expect(computer.status().session).toEqual({ mode, nodeId: 'chat-1' });
            helper.hold('running');
            timers.advance(SESSION_POLL_MS);
            await until(() => computer.status().session?.operatingRuimte === true);
        }
    });

    test('ends once the actions went to another app for the settle time', async () => {
        const setup = await computerSetup();
        const { computer, timers } = setup;
        await clickRuimte(setup);
        const call = computer.operate('chat-1', 'state', 'TextEdit', {});
        await until(() => computer.pendingApprovals().length === 1);
        await computer.answer(computer.pendingApprovals()[0]!.requestId, 'once');
        await call;
        expect(computer.operatingRuimte()).toBe(true);
        timers.advance(RUIMTE_SETTLE_MS - 1);
        expect(computer.operatingRuimte()).toBe(true);
        timers.advance(1);
        expect(computer.operatingRuimte()).toBe(false);
        // The poll of the session says so to the clients.
        await until(() => computer.status().session?.operatingRuimte === undefined);
        await computer.operate('chat-1', 'click', 'Ruimte', { element: 1 });
        expect(computer.operatingRuimte()).toBe(true);
    });

    test('ends with the session, and a new session starts without it', async () => {
        const setup = await computerSetup();
        const { computer, helper } = setup;
        await clickRuimte(setup);
        computer.observe(turnEnded('chat-1', 'done'));
        await until(() => computer.status().session === null);
        expect(computer.operatingRuimte()).toBe(false);
        await computer.operate('chat-1', 'state', 'Ruimte', {});
        expect(helper.session.active).toBe(true);
        expect(computer.operatingRuimte()).toBe(true);
        await letIn(setup);
        helper.session = { active: false, mode: 'running', stopped: false };
        await computer.refreshStatus();
        await computer.operate('chat-1', 'click', 'TextEdit', { element: 1 });
        expect(computer.operatingRuimte()).toBe(false);
    });
});
