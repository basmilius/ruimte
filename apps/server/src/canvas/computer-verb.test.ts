import { describe, expect, test } from 'bun:test';
import { computerSetup, until, type ComputerSetup } from '../computer/computer-test-helpers.ts';
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

describe('ruimte-context computer', () => {
    test('is a noun of help with every action', () => {
        expect(VERBS).toContain(noun);
        expect(noun.actions.map((action) => action.word)).toEqual(['apps', 'state', 'click', 'type', 'key', 'set-value', 'scroll', 'menu', 'open']);
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
        expect(lines).toContain('elements\t2');
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

    test('refuses a terminal whatever was granted', async () => {
        const setup = await computerSetup();
        expect((await run(setup, ['state', 'Shells']))[0]).toStartWith('refused\tterminal\tShells runs shells');
    });
});
