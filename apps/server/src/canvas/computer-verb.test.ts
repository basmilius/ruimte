import { describe, expect, test } from 'bun:test';
import { READ_MAX_CHARS } from '../actions/computer-actions.ts';
import { computerSetup, SAMPLE_STATE, turnEnded, until, type ComputerSetup } from '../computer/computer-test-helpers.ts';
import { refusalBody } from '../refusal.ts';
import { VerbRefusal, type CanvasHost, type Noun } from './verb.ts';
import { VERBS, verbNamed } from './verbs.ts';

const noun = verbNamed('computer') as Noun;

/* Only what a computer verb reaches: where the caller stands, and the machine's computer use. */
const hostFor = (setup: ComputerSetup): CanvasHost =>
    ({
        locate: () => ({ projectId: 'p1', folder: '/tmp/p1', canvasId: 'c1' }),
        computer: setup.computer
    }) as unknown as CanvasHost;

/* What the CLI prints: the lines of an answer, or the refusal with its advice. */
const run = async (setup: ComputerSetup, argv: string[], caller = 'chat-1'): Promise<string[]> => {
    try {
        return await noun.run(argv, { caller, host: hostFor(setup) });
    } catch (error) {
        if (error instanceof VerbRefusal) {
            return refusalBody(error.code, error.message, error.lines).split('\n');
        }
        throw error;
    }
};

/* Lets the agent in for this time, so what follows is about the answer and not about asking. */
const approved = async (setup: ComputerSetup): Promise<void> => {
    const call = run(setup, ['state', 'TextEdit']);
    await until(() => setup.computer.pendingApprovals().length === 1);
    await setup.computer.answer(setup.computer.pendingApprovals()[0]!.requestId, 'once');
    await call;
};

/* The state rows after an action on a window that did not change. */
const UNCHANGED = ['window\tUntitled\t292,161\t586x488', 'shot\t/home/computer-use/screenshots/shot.png\t1172x976\t2\t292,161', 'changes\tnone'];

describe('ruimte-context computer', () => {
    test('is a noun of help with every action', () => {
        expect(VERBS).toContain(noun);
        expect(noun.actions.map((action) => action.word)).toEqual([
            'apps',
            'state',
            'read',
            'click',
            'type',
            'key',
            'set-value',
            'scroll',
            'drag',
            'menu',
            'open',
            'wait'
        ]);
        for (const action of noun.actions) {
            expect(action.detail.some((line) => line.startsWith('approval\t'))).toBe(action.word !== 'apps');
        }
    });

    test('refuses while computer use is off on this machine', async () => {
        const setup = await computerSetup({ enabled: false });
        expect((await run(setup, ['apps']))[0]).toStartWith('refused\tcomputer-use-off\t');
        expect((await run(setup, ['state', 'TextEdit']))[0]).toStartWith('refused\tcomputer-use-off\t');
    });

    test('lists apps with their access, one row each', async () => {
        const setup = await computerSetup();
        expect(await run(setup, ['apps'])).toEqual([
            'app\tTextEdit\tcom.example.textedit\t501\task\tfront',
            'app\tShells\tcom.example.shells\t777\tterminal\t-'
        ]);
    });

    test('answers awaiting-approval while the card is up, and the tree as rows once it was answered', async () => {
        const setup = await computerSetup();
        const call = run(setup, ['state', 'TextEdit']);
        await until(() => setup.computer.pendingApprovals().length === 1);
        setup.timers.advance(10_000);
        expect((await call)[0]).toStartWith('refused\tawaiting-approval\tA card asking the person to let you operate TextEdit is up');
        await setup.computer.answer(setup.computer.pendingApprovals()[0]!.requestId, 'once');
        expect(await run(setup, ['state', 'TextEdit', '--no-screenshot', '--max-depth', '5'])).toEqual([
            'app\tTextEdit\tcom.example.textedit\t501',
            'window\tUntitled\t292,161\t586x488',
            'shot\t/home/computer-use/screenshots/shot.png\t1172x976\t2\t292,161',
            'elements\t2',
            'tree\t[0] Window:StandardWindow "Untitled" (292,161 586x488)',
            'tree\t  [1] TextArea value="hi" (292,261 586x382) focused'
        ]);
        expect(setup.helper.acted.at(-1)).toMatchObject({ command: 'state', screenshot: false, maxDepth: 5 });
    });

    test('an action prints what it did and, with --state, the state after it', async () => {
        const setup = await computerSetup();
        await approved(setup);
        const lines = await run(setup, ['click', 'TextEdit', '--element', '4', '--count', '2', '--state']);
        expect(lines.slice(0, 5)).toEqual([
            'done\tclick\tTextEdit',
            'target\tButton\tSave\t-\tUntitled',
            'point\t400,300',
            'detail\tmethod\tAXPress',
            'settled\tyes'
        ]);
        // The tree after it is the one the agent read before, so nothing changed.
        expect(lines.slice(5)).toEqual([
            'window\tUntitled\t292,161\t586x488',
            'shot\t/home/computer-use/screenshots/shot.png\t1172x976\t2\t292,161',
            'changes\tnone'
        ]);
        expect(setup.helper.acted.at(-1)).toMatchObject({ command: 'click', app: '501', element: 4, count: 2, withState: true });
    });

    test('maps every action onto the helper command and its fields', async () => {
        const setup = await computerSetup();
        await approved(setup);
        await run(setup, ['type', 'TextEdit', '--text=--flag']);
        await run(setup, ['key', 'TextEdit', 'cmd+n', 'return']);
        await run(setup, ['set-value', 'TextEdit', '--element', '2', '--value', 'hi']);
        await run(setup, ['scroll', 'TextEdit', '--x', '10.5', '--y', '20', '--direction', 'down', '--pages', '2']);
        await run(setup, ['menu', 'TextEdit', 'File > Save']);
        await run(setup, ['open', 'TextEdit']);
        expect(setup.helper.acted.slice(-6).map(({ secret: _secret, ...request }) => request)).toEqual([
            { command: 'type', app: '501', text: '--flag' },
            { command: 'key', app: '501', combos: ['cmd+n', 'return'] },
            { command: 'set-value', app: '501', element: 2, value: 'hi' },
            { command: 'scroll', app: '501', x: 10.5, y: 20, direction: 'down', pages: 2 },
            { command: 'menu', app: '501', path: 'File > Save' },
            { command: 'open', app: '501' }
        ]);
    });

    test('refuses arguments the helper would refuse, before anyone is asked', async () => {
        const setup = await computerSetup();
        expect((await run(setup, ['click', 'TextEdit']))[0]).toStartWith('refused\tbad-arguments\t');
        expect((await run(setup, ['click', 'TextEdit', '--element', '1', '--x', '3', '--y', '4']))[0]).toStartWith('refused\tbad-arguments\t');
        expect((await run(setup, ['key', 'TextEdit']))[0]).toStartWith('refused\tbad-arguments\t');
        expect((await run(setup, ['type', 'TextEdit']))[0]).toStartWith('refused\tbad-arguments\t');
        expect(setup.computer.pendingApprovals()).toEqual([]);
    });

    test('holds as long as --wait asks, within its bounds', async () => {
        const setup = await computerSetup();
        const call = run(setup, ['state', 'TextEdit', '--wait', '60']);
        await until(() => setup.computer.pendingApprovals().length === 1);
        expect(setup.timers.waitingFor(60_000)).toBe(1);
        await setup.computer.answer(setup.computer.pendingApprovals()[0]!.requestId, 'once');
        expect(await call).toContain('elements\t2');
        expect((await run(setup, ['click', 'TextEdit', '--element', '1', '--wait', '111']))[0]).toStartWith(
            'refused\tbad-arguments\t--wait is between 1 and 110'
        );
        expect(setup.helper.acted.every((request) => !('wait' in request))).toBe(true);
    });

    test('after an action, --state prints only what changed against the last tree, and --state=full all of it', async () => {
        const setup = await computerSetup();
        await approved(setup);
        setup.helper.state = {
            ...SAMPLE_STATE,
            tree: [
                '[0] Window:StandardWindow "Untitled" (292,161 586x488)',
                '  [1] TextArea value="hi there" (292,261 586x382) focused',
                '  [5] Button "Save" (700,600 80x24)'
            ]
        };
        const changed = await run(setup, ['type', 'TextEdit', '--text', ' there', '--state']);
        expect(changed.slice(changed.indexOf('changes\t1 new\t0 gone\t1 changed'))).toEqual([
            'changes\t1 new\t0 gone\t1 changed',
            'tree\t~   [1] TextArea value="hi there" (292,261 586x382) focused',
            'tree\t+   [5] Button "Save" (700,600 80x24)'
        ]);
        expect(await run(setup, ['key', 'TextEdit', 'cmd+s', '--state'])).toContain('changes\tnone');
        const whole = await run(setup, ['key', 'TextEdit', 'cmd+s', '--state=full']);
        expect(whole).toContain('elements\t2');
        expect(whole.filter((line) => line.startsWith('tree\t'))).toHaveLength(3);
        expect(whole.some((line) => line.startsWith('full\t') || line.startsWith('changes\t'))).toBe(false);
    });

    test('prints the whole tree after an action and says why when it cannot tell a change', async () => {
        const setup = await computerSetup();
        const call = run(setup, ['state', 'TextEdit']);
        await until(() => setup.computer.pendingApprovals().length === 1);
        await setup.computer.answer(setup.computer.pendingApprovals()[0]!.requestId, 'always');
        await call;
        setup.helper.state = { ...SAMPLE_STATE, tree: ['[8] Window:StandardWindow "Other" (0,0 10x10)'] };
        expect(await run(setup, ['click', 'TextEdit', '--element', '1', '--state'])).toContain('full\ta new window');
        // The terminal's agent has read nothing of this app yet; it gets the Mac once the chat's turn ended.
        setup.computer.observe(turnEnded('chat-1', 'done'));
        expect(await run(setup, ['click', 'TextEdit', '--element', '1', '--state'], 'term-1')).toContain('full\tthe first state of this app you got');
    });

    test('state --find and --within ask the helper for part of the window, which later changes are not told against', async () => {
        const setup = await computerSetup();
        await approved(setup);
        setup.helper.state = { ...SAMPLE_STATE, tree: ['[0] Window:StandardWindow "Untitled" (292,161 586x488)'], elements: 1, matches: 1 };
        const found = await run(setup, ['state', 'TextEdit', '--find', 'untitled']);
        expect(found).toContain('matches\t1');
        expect(setup.helper.acted.at(-1)).toMatchObject({ command: 'state', find: 'untitled' });
        expect(await run(setup, ['state', 'TextEdit', '--within', '0'])).toContain('within\t0');
        expect(setup.helper.acted.at(-1)).toMatchObject({ command: 'state', within: 0 });
        setup.helper.state = SAMPLE_STATE;
        expect(await run(setup, ['click', 'TextEdit', '--element', '1', '--state'])).toContain('changes\tnone');
    });

    test('read prints every text of an element whole, a row per line, and cuts one past the cap', async () => {
        const setup = await computerSetup();
        await approved(setup);
        setup.helper.readValue = 'first\nsecond';
        expect(await run(setup, ['read', 'TextEdit', '--element', '1'])).toEqual([
            'done\tread\tTextEdit',
            'element\t1\tTextArea',
            'frame\t1,2\t3x4',
            'value\tfirst',
            'value\tsecond'
        ]);
        setup.helper.readValue = 'x'.repeat(READ_MAX_CHARS + 5);
        const long = await run(setup, ['read', 'TextEdit', '--element', '1']);
        expect(long.find((line) => line.startsWith('value\t'))).toBe(`value\t${'x'.repeat(READ_MAX_CHARS)}`);
        expect(long.at(-1)).toBe(`cut\tvalue\t${READ_MAX_CHARS}\t${READ_MAX_CHARS + 5}`);
        expect((await run(setup, ['read', 'TextEdit']))[0]).toStartWith('refused\tbad-arguments\t');
    });

    test('wait takes one condition, prints what changed once it holds, and refuses with the state when time is up', async () => {
        const setup = await computerSetup();
        await approved(setup);
        expect(await run(setup, ['wait', 'TextEdit', '--text', 'Saved'])).toEqual(['done\twait\tTextEdit\t"Saved" to appear\t1.5', ...UNCHANGED]);
        expect(setup.helper.acted.at(-1)).toMatchObject({ command: 'wait', text: 'Saved', timeout: 10 });
        await run(setup, ['wait', 'TextEdit', '--element', '1', '--value', 'done', '--timeout', '60']);
        expect(setup.helper.acted.at(-1)).toMatchObject({ command: 'wait', element: 1, value: 'done', timeout: 60 });
        setup.helper.waitMet = false;
        const late = await run(setup, ['wait', 'TextEdit', '--gone', 'Exporting', '--timeout', '3']);
        expect(late[0]).toStartWith('refused\ttimeout\tWaited 3 s for "Exporting" to go, and it did not happen.');
        expect(late.slice(1)).toEqual(UNCHANGED);
        for (const argv of [
            ['wait', 'TextEdit'],
            ['wait', 'TextEdit', '--text', 'a', '--gone', 'b'],
            ['wait', 'TextEdit', '--element', '1']
        ]) {
            expect((await run(setup, argv))[0]).toStartWith('refused\tbad-arguments\tcomputer wait takes one of');
        }
        expect((await run(setup, ['wait', 'TextEdit', '--text', 'a', '--timeout', '111']))[0]).toStartWith(
            'refused\tbad-arguments\t--timeout is between 1 and 110'
        );
    });

    test("drag maps both ends onto the helper, refuses a mix, and passes on the helper's check of the start", async () => {
        const setup = await computerSetup();
        await approved(setup);
        await run(setup, ['drag', 'TextEdit', '--from', '3', '--to-x', '40', '--to-y', '50.5']);
        await run(setup, ['drag', 'TextEdit', '--from-x', '1', '--from-y', '2', '--to', '7']);
        expect(setup.helper.acted.slice(-2).map(({ secret: _secret, ...request }) => request)).toEqual([
            { command: 'drag', app: '501', element: 3, toX: 40, toY: 50.5 },
            { command: 'drag', app: '501', x: 1, y: 2, toElement: 7 }
        ]);
        expect((await run(setup, ['drag', 'TextEdit', '--from', '3', '--from-x', '1', '--from-y', '2', '--to', '7']))[0]).toStartWith(
            'refused\tbad-arguments\tcomputer drag starts at --from N'
        );
        expect((await run(setup, ['drag', 'TextEdit', '--from', '3', '--to-x', '4']))[0]).toStartWith('refused\tbad-arguments\tcomputer drag ends at --to N');
        setup.helper.error = 'element 3 is no longer at (10, 20); the point now hits Button "OK". Run `cu state` again';
        expect((await run(setup, ['drag', 'TextEdit', '--from', '3', '--to', '7']))[0]).toBe(
            'refused\tapp-refused\telement 3 is no longer at (10, 20); the point now hits Button "OK". Run `ruimte-context computer state` again'
        );
        expect((await run(setup, ['drag', 'Shells', '--from', '3', '--to', '7']))[0]).toStartWith('refused\tterminal\t');
    });

    test('refuses a terminal whatever was granted', async () => {
        const setup = await computerSetup();
        expect((await run(setup, ['state', 'Shells']))[0]).toStartWith('refused\tterminal\tShells runs shells');
    });
});
