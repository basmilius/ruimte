import { describe, expect, test } from 'bun:test';
import { MAX_KEY_COMBOS, MAX_TYPED_LENGTH } from '@ruimte/actions';
import { READ_MAX_CHARS } from '../actions/computer-actions.ts';
import { computerSetup, SAMPLE_STATE, turnEnded, until, type ComputerSetup } from '../computer/computer-test-helpers.ts';
import type { CanvasHost } from './host.ts';
import { toolAnswer, toolCall } from './tool-test-helpers.ts';

/* Only what a computer tool reaches: where the caller stands, and the machine's computer use. */
function hostFor(setup: ComputerSetup): CanvasHost {
    return {
        projects: { locate: () => ({ projectId: 'p1', folder: '/tmp/p1', canvasId: 'c1' }) },
        computer: setup.computer
    } as unknown as CanvasHost;
}

async function run(setup: ComputerSetup, tool: string, input: Record<string, unknown>, caller = 'chat-1'): Promise<string[]> {
    return (await toolAnswer(tool, input, toolCall(caller, hostFor(setup)))).lines;
}

/* Lets the agent in for this time, so what follows is about the answer and not about asking. */
async function approved(setup: ComputerSetup): Promise<void> {
    const call = run(setup, 'computer_state', { app: 'TextEdit' });
    await until(() => setup.computer.pendingApprovals().length === 1);
    await setup.computer.answer(setup.computer.pendingApprovals()[0]!.requestId, 'once');
    await call;
}

/* The state rows after an action on a window that did not change. */
const UNCHANGED = ['window\tUntitled\t292,161\t586x488', 'shot\t/home/computer-use/screenshots/shot.png\t1172x976\t2\t292,161', 'changes\tnone'];

describe('computer tools', () => {
    test('refuses while computer use is off on this machine', async () => {
        const setup = await computerSetup({ enabled: false });
        expect((await run(setup, 'computer_apps', {}))[0]).toStartWith('refused\tcomputer-use-off\t');
        expect((await run(setup, 'computer_state', { app: 'TextEdit' }))[0]).toStartWith('refused\tcomputer-use-off\t');
    });

    test('lists apps with their access, one row each', async () => {
        const setup = await computerSetup();
        expect(await run(setup, 'computer_apps', {})).toEqual([
            'app\tTextEdit\tcom.example.textedit\t501\task\tfront',
            'app\tShells\tcom.example.shells\t777\tterminal\t-'
        ]);
    });

    test('answers awaiting-approval while the card is up, and the tree as rows once it was answered', async () => {
        const setup = await computerSetup();
        const call = run(setup, 'computer_state', { app: 'TextEdit' });
        await until(() => setup.computer.pendingApprovals().length === 1);
        setup.timers.advance(10_000);
        expect((await call)[0]).toStartWith('refused\tawaiting-approval\tA card asking the person to let you operate TextEdit is up');
        await setup.computer.answer(setup.computer.pendingApprovals()[0]!.requestId, 'once');
        expect(await run(setup, 'computer_state', { app: 'TextEdit', no_screenshot: true, max_depth: 5 })).toEqual([
            'app\tTextEdit\tcom.example.textedit\t501',
            'window\tUntitled\t292,161\t586x488',
            'shot\t/home/computer-use/screenshots/shot.png\t1172x976\t2\t292,161',
            'elements\t2',
            'tree\t[0] Window:StandardWindow "Untitled" (292,161 586x488)',
            'tree\t  [1] TextArea value="hi" (292,261 586x382) focused'
        ]);
        expect(setup.helper.acted.at(-1)).toMatchObject({ command: 'state', screenshot: false, maxDepth: 5 });
    });

    test('a state hands its picture back as image content, as a browser or device shot does', async () => {
        const setup = await computerSetup();
        await approved(setup);
        const call = toolCall('chat-1', hostFor(setup));

        expect((await toolAnswer('computer_state', { app: 'TextEdit' }, call)).images).toEqual([SAMPLE_STATE.screenshot.path]);
        expect((await toolAnswer('computer_act', { action: 'click', app: 'TextEdit', element: 4, state: 'on' }, call)).images).toEqual([
            SAMPLE_STATE.screenshot.path
        ]);
    });

    test('an action prints what it did and, with state, the state after it', async () => {
        const setup = await computerSetup();
        await approved(setup);
        const lines = await run(setup, 'computer_act', { action: 'click', app: 'TextEdit', element: 4, count: 2, state: 'on' });
        expect(lines.slice(0, 5)).toEqual([
            'done\tclick\tTextEdit',
            'target\tButton\tSave\t-\tUntitled',
            'point\t400,300',
            'detail\tmethod\tAXPress',
            'settled\tyes'
        ]);
        // The tree after it is the one the agent read before, so nothing changed.
        expect(lines.slice(5)).toEqual(UNCHANGED);
        expect(setup.helper.acted.at(-1)).toMatchObject({ command: 'click', app: '501', element: 4, count: 2, withState: true });
    });

    test('maps every action onto the helper command and its fields', async () => {
        const setup = await computerSetup();
        await approved(setup);
        await run(setup, 'computer_act', { action: 'type', app: 'TextEdit', text: '--flag' });
        await run(setup, 'computer_act', { action: 'key', app: 'TextEdit', combo: ['cmd+n', 'return'] });
        await run(setup, 'computer_act', { action: 'set-value', app: 'TextEdit', element: 2, value: 'hi' });
        await run(setup, 'computer_act', { action: 'scroll', app: 'TextEdit', x: 10.5, y: 20, direction: 'down', pages: 2 });
        await run(setup, 'computer_menu', { app: 'TextEdit', item: ['File > Save'] });
        await run(setup, 'computer_open', { app: 'TextEdit' });
        expect(setup.helper.acted.slice(-6).map(({ secret: _secret, ...request }) => request)).toEqual([
            { command: 'type', app: '501', text: '--flag' },
            { command: 'key', app: '501', combos: ['cmd+n', 'return'] },
            { command: 'set-value', app: '501', element: 2, value: 'hi' },
            { command: 'scroll', app: '501', x: 10.5, y: 20, direction: 'down', pages: 2 },
            { command: 'menu', app: '501', path: 'File > Save' },
            { command: 'open', app: '501' }
        ]);
    });

    test('works in the background unless the agent asks for the front', async () => {
        const setup = await computerSetup();
        await approved(setup);
        await run(setup, 'computer_act', { action: 'click', app: 'TextEdit', element: 4 });
        expect(setup.helper.acted.at(-1)?.front).toBeUndefined();
        await run(setup, 'computer_act', { action: 'click', app: 'TextEdit', x: 10, y: 20, front: true });
        await run(setup, 'computer_state', { app: 'TextEdit', front: true });
        await run(setup, 'computer_read', { app: 'TextEdit', element: 1, front: true });
        await run(setup, 'computer_wait', { app: 'TextEdit', text: 'hi', front: true });
        expect(setup.helper.acted.slice(-4).map((request) => [request.command, request.front])).toEqual([
            ['click', true],
            ['state', true],
            ['read', true],
            ['wait', true]
        ]);
    });

    test('says needs-front with the way on, for what only the front can do', async () => {
        const setup = await computerSetup();
        await approved(setup);
        setup.helper.error = 'A click by pixel needs the real pointer, and so the app in front. Call again with front: that brings the app forward';
        setup.helper.errorCode = 'needs-front';
        const [line] = await run(setup, 'computer_act', { action: 'click', app: 'TextEdit', x: 10, y: 20 });
        expect(line).toStartWith('refused\tneeds-front\tA click by pixel needs the real pointer');
        expect(line).toContain('Call again with front');
    });

    test('refuses arguments the helper would refuse, and a field of another action, before anyone is asked', async () => {
        const setup = await computerSetup();
        expect(await run(setup, 'computer_act', { action: 'type', app: 'TextEdit', text: 'hi', direction: 'down' })).toEqual([
            'refused\tbad-arguments\tcomputer_act type takes no direction',
            'fields\taction\tapp\tstate\twait\tmax_depth\tmax_elements\tmax_text\tno_screenshot\tfront\ttext'
        ]);
        expect((await run(setup, 'computer_menu', { app: 'TextEdit', item: ['File', 'Save'] }))[0]).toStartWith(
            'refused\tbad-arguments\tcomputer_menu takes at most one item'
        );
        expect((await run(setup, 'computer_act', { action: 'click', app: 'TextEdit' }))[0]).toStartWith('refused\tbad-arguments\t');
        expect((await run(setup, 'computer_act', { action: 'click', app: 'TextEdit', element: 1, x: 3, y: 4 }))[0]).toStartWith('refused\tbad-arguments\t');
        expect((await run(setup, 'computer_act', { action: 'key', app: 'TextEdit' }))[0]).toStartWith('refused\tbad-arguments\t');
        expect((await run(setup, 'computer_act', { action: 'type', app: 'TextEdit' }))[0]).toStartWith('refused\tbad-arguments\t');
        expect(setup.computer.pendingApprovals()).toEqual([]);
    });

    test('refuses more text or keys than one call types, before anyone is asked', async () => {
        const setup = await computerSetup();
        const tooLong = await run(setup, 'computer_act', { action: 'type', app: 'TextEdit', text: 'a'.repeat(MAX_TYPED_LENGTH + 1) });
        expect(tooLong[0]).toStartWith('refused\tinvalid-input\t');
        expect(tooLong.join('\n')).toContain(`At most ${MAX_TYPED_LENGTH} characters at a time`);
        const tooMany = await run(setup, 'computer_act', { action: 'key', app: 'TextEdit', combo: Array.from({ length: MAX_KEY_COMBOS + 1 }, () => 'tab') });
        expect(tooMany[0]).toStartWith('refused\tinvalid-input\t');
        expect(setup.computer.pendingApprovals()).toEqual([]);
        expect(setup.helper.acted).toEqual([]);
    });

    test('holds as long as wait asks, within its bounds', async () => {
        const setup = await computerSetup();
        const call = run(setup, 'computer_state', { app: 'TextEdit', wait: 60 });
        await until(() => setup.computer.pendingApprovals().length === 1);
        expect(setup.timers.waitingFor(60_000)).toBe(1);
        await setup.computer.answer(setup.computer.pendingApprovals()[0]!.requestId, 'once');
        expect(await call).toContain('elements\t2');
        expect((await run(setup, 'computer_act', { action: 'click', app: 'TextEdit', element: 1, wait: 111 }))[0]).toStartWith(
            'refused\tbad-arguments\twait is between 1 and 110'
        );
        expect(setup.helper.acted.every((request) => !('wait' in request))).toBe(true);
    });

    test('after an action, state on prints only what changed against the last tree, and state full all of it', async () => {
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
        const changed = await run(setup, 'computer_act', { action: 'type', app: 'TextEdit', text: ' there', state: 'on' });
        expect(changed.slice(changed.indexOf('changes\t1 new\t0 gone\t1 changed'))).toEqual([
            'changes\t1 new\t0 gone\t1 changed',
            'tree\t~   [1] TextArea value="hi there" (292,261 586x382) focused',
            'tree\t+   [5] Button "Save" (700,600 80x24)'
        ]);
        expect(await run(setup, 'computer_act', { action: 'key', app: 'TextEdit', state: 'on', combo: ['cmd+s'] })).toContain('changes\tnone');
        const whole = await run(setup, 'computer_act', { action: 'key', app: 'TextEdit', state: 'full', combo: ['cmd+s'] });
        expect(whole).toContain('elements\t2');
        expect(whole.filter((line) => line.startsWith('tree\t'))).toHaveLength(3);
        expect(whole.some((line) => line.startsWith('full\t') || line.startsWith('changes\t'))).toBe(false);
    });

    test('prints the whole tree after an action and says why when it cannot tell a change', async () => {
        const setup = await computerSetup();
        const call = run(setup, 'computer_state', { app: 'TextEdit' });
        await until(() => setup.computer.pendingApprovals().length === 1);
        await setup.computer.answer(setup.computer.pendingApprovals()[0]!.requestId, 'always');
        await call;
        setup.helper.state = { ...SAMPLE_STATE, tree: ['[8] Window:StandardWindow "Other" (0,0 10x10)'] };
        expect(await run(setup, 'computer_act', { action: 'click', app: 'TextEdit', element: 1, state: 'on' })).toContain('full\ta new window');
        // The terminal's agent has read nothing of this app yet; it gets the Mac once the chat's turn ended.
        setup.computer.observe(turnEnded('chat-1', 'done'));
        expect(await run(setup, 'computer_act', { action: 'click', app: 'TextEdit', element: 1, state: 'on' }, 'term-1')).toContain(
            'full\tthe first state of this app you got'
        );
    });

    test('computer_state find and within ask the helper for part of the window, which later changes are not told against', async () => {
        const setup = await computerSetup();
        await approved(setup);
        setup.helper.state = { ...SAMPLE_STATE, tree: ['[0] Window:StandardWindow "Untitled" (292,161 586x488)'], elements: 1, matches: 1 };
        const found = await run(setup, 'computer_state', { app: 'TextEdit', find: 'untitled' });
        expect(found).toContain('matches\t1');
        expect(setup.helper.acted.at(-1)).toMatchObject({ command: 'state', find: 'untitled' });
        expect(await run(setup, 'computer_state', { app: 'TextEdit', within: 0 })).toContain('within\t0');
        expect(setup.helper.acted.at(-1)).toMatchObject({ command: 'state', within: 0 });
        setup.helper.state = SAMPLE_STATE;
        expect(await run(setup, 'computer_act', { action: 'click', app: 'TextEdit', element: 1, state: 'on' })).toContain('changes\tnone');
    });

    test('read prints every text of an element whole, a row per line, and cuts one past the cap', async () => {
        const setup = await computerSetup();
        await approved(setup);
        setup.helper.readValue = 'first\nsecond';
        expect(await run(setup, 'computer_read', { app: 'TextEdit', element: 1 })).toEqual([
            'done\tread\tTextEdit',
            'element\t1\tTextArea',
            'frame\t1,2\t3x4',
            'value\tfirst',
            'value\tsecond'
        ]);
        setup.helper.readValue = 'x'.repeat(READ_MAX_CHARS + 5);
        const long = await run(setup, 'computer_read', { app: 'TextEdit', element: 1 });
        expect(long.find((line) => line.startsWith('value\t'))).toBe(`value\t${'x'.repeat(READ_MAX_CHARS)}`);
        expect(long.at(-1)).toBe(`cut\tvalue\t${READ_MAX_CHARS}\t${READ_MAX_CHARS + 5}`);
        expect((await run(setup, 'computer_read', { app: 'TextEdit' }))[0]).toStartWith('refused\tbad-arguments\t');
    });

    test('wait takes one condition, prints what changed once it holds, and refuses with the state when time is up', async () => {
        const setup = await computerSetup();
        await approved(setup);
        expect(await run(setup, 'computer_wait', { app: 'TextEdit', text: 'Saved' })).toEqual(['done\twait\tTextEdit\t"Saved" to appear\t1.5', ...UNCHANGED]);
        expect(setup.helper.acted.at(-1)).toMatchObject({ command: 'wait', text: 'Saved', timeout: 10 });
        await run(setup, 'computer_wait', { app: 'TextEdit', element: 1, value: 'done', timeout: 60 });
        expect(setup.helper.acted.at(-1)).toMatchObject({ command: 'wait', element: 1, value: 'done', timeout: 60 });
        setup.helper.waitMet = false;
        const late = await run(setup, 'computer_wait', { app: 'TextEdit', gone: 'Exporting', timeout: 3 });
        expect(late[0]).toStartWith('refused\ttimeout\tWaited 3 s for "Exporting" to go, and it did not happen.');
        expect(late.slice(1)).toEqual(UNCHANGED);
        for (const input of [{ app: 'TextEdit' }, { app: 'TextEdit', text: 'a', gone: 'b' }, { app: 'TextEdit', element: 1 }]) {
            expect((await run(setup, 'computer_wait', input))[0]).toStartWith('refused\tbad-arguments\tcomputer_wait takes one of');
        }
        expect((await run(setup, 'computer_wait', { app: 'TextEdit', text: 'a', timeout: 111 }))[0]).toStartWith(
            'refused\tbad-arguments\ttimeout is between 1 and 110'
        );
    });

    test("drag maps both ends onto the helper, refuses a mix, and passes on the helper's check of the start", async () => {
        const setup = await computerSetup();
        await approved(setup);
        await run(setup, 'computer_act', { action: 'drag', app: 'TextEdit', from: 3, to_x: 40, to_y: 50.5 });
        await run(setup, 'computer_act', { action: 'drag', app: 'TextEdit', from_x: 1, from_y: 2, to: 7 });
        expect(setup.helper.acted.slice(-2).map(({ secret: _secret, ...request }) => request)).toEqual([
            { command: 'drag', app: '501', element: 3, toX: 40, toY: 50.5 },
            { command: 'drag', app: '501', x: 1, y: 2, toElement: 7 }
        ]);
        expect((await run(setup, 'computer_act', { action: 'drag', app: 'TextEdit', from: 3, from_x: 1, from_y: 2, to: 7 }))[0]).toStartWith(
            'refused\tbad-arguments\tcomputer_act drag starts at from'
        );
        expect((await run(setup, 'computer_act', { action: 'drag', app: 'TextEdit', from: 3, to_x: 4 }))[0]).toStartWith(
            'refused\tbad-arguments\tcomputer_act drag ends at to'
        );
        setup.helper.error = 'element 3 is no longer at (10, 20); the point now hits Button "OK". Run `cu state` again';
        expect((await run(setup, 'computer_act', { action: 'drag', app: 'TextEdit', from: 3, to: 7 }))[0]).toBe(
            'refused\tapp-refused\telement 3 is no longer at (10, 20); the point now hits Button "OK". Run `computer_state` again'
        );
        expect((await run(setup, 'computer_act', { action: 'drag', app: 'Shells', from: 3, to: 7 }))[0]).toStartWith('refused\tterminal\t');
    });

    test('refuses a terminal whatever was granted', async () => {
        const setup = await computerSetup();
        expect((await run(setup, 'computer_state', { app: 'Shells' }))[0]).toStartWith('refused\tterminal\tShells runs shells');
    });
});
