import { expect, test } from 'bun:test';
import { ShellPrompt, type ShellEditorState } from './shell-prompt.ts';

function fixture() {
    const prompt = new ShellPrompt();
    let state: ShellEditorState | null = { cwd: '/work tree', empty: true };
    const commands: string[] = [];
    const disconnect = prompt.connect({
        async inspect() {
            return state;
        },
        async prepare(cwd, command) {
            if (!state?.empty || state.cwd !== cwd) {
                return 'refused';
            }
            commands.push(command);
            state.empty = false;
            return 'inserted';
        },
        close() {}
    });
    return {
        prompt,
        commands,
        disconnect,
        setState(value: ShellEditorState | null) {
            state = value;
        }
    };
}

test('working directory is a live observation with explicit unknown state', async () => {
    const { prompt, setState, disconnect } = fixture();
    expect(prompt.snapshot()).toBeNull();
    expect(await prompt.workingDirectory()).toMatchObject({ state: 'known', cwd: '/work tree' });
    setState({ cwd: '/changed', empty: false });
    expect(await prompt.workingDirectory()).toMatchObject({ state: 'known', cwd: '/changed' });
    expect(prompt.snapshot()).toBeNull();
    disconnect();
    expect(await prompt.workingDirectory()).toEqual({ state: 'unknown' });
    expect(await new ShellPrompt().workingDirectory()).toEqual({ state: 'unknown' });
});

test('input and editor replacement invalidate the preview before any async work', async () => {
    const { prompt, commands } = fixture();
    await prompt.inspect();
    const preview = prompt.snapshot()!;
    prompt.input();
    expect(prompt.snapshot()).toBeNull();
    expect(await prompt.prepare(preview, 'echo hi', () => {})).toBe('refused');
    expect(commands).toEqual([]);
});

test('the editor repeats buffer and cwd checks when the command arrives', async () => {
    for (const changed of [{ cwd: '/other', empty: true }, { cwd: '/work tree', empty: false }, null]) {
        const { prompt, commands, setState } = fixture();
        await prompt.inspect();
        const preview = prompt.snapshot()!;
        setState(changed);
        expect(await prompt.prepare(preview, 'echo hi', () => {})).toBe('refused');
        expect(commands).toEqual([]);
    }
});

test('input while a live inspection is pending discards its answer', async () => {
    const prompt = new ShellPrompt();
    const reply = Promise.withResolvers<ShellEditorState | null>();
    prompt.connect({ inspect: () => reply.promise, prepare: async () => 'refused', close() {} });
    const pending = prompt.workingDirectory();
    prompt.input();
    reply.resolve({ cwd: '/old', empty: true });
    expect(await pending).toEqual({ state: 'unknown' });
    expect(prompt.snapshot()).toBeNull();
});

test('a late connection cannot revive an exited session', async () => {
    const { prompt, commands } = fixture();
    await prompt.inspect();
    const preview = prompt.snapshot()!;
    prompt.dispose();
    let closed = false;
    prompt.connect({
        inspect: async () => ({ cwd: '/work tree', empty: true }),
        prepare: async () => 'inserted',
        close() {
            closed = true;
        }
    });
    expect(closed).toBe(true);
    expect(await prompt.workingDirectory()).toEqual({ state: 'unknown' });
    expect(await prompt.prepare(preview, 'echo hi', () => {})).toBe('refused');
    expect(commands).toEqual([]);
});

test('an unknown editor answer clears an earlier preview observation', async () => {
    const { prompt, setState } = fixture();
    await prompt.inspect();
    expect(prompt.snapshot()).not.toBeNull();
    setState(null);
    expect(await prompt.workingDirectory()).toEqual({ state: 'unknown' });
    expect(prompt.snapshot()).toBeNull();
});

test('input revokes preparation while its editor operation is pending', async () => {
    const prompt = new ShellPrompt();
    const reply = Promise.withResolvers<'refused'>();
    let signal: AbortSignal | undefined;
    prompt.connect({
        inspect: async () => ({ cwd: '/work', empty: true }),
        prepare: async (_cwd, _command, current) => {
            signal = current;
            return reply.promise;
        },
        close() {}
    });
    await prompt.inspect();
    const operation = prompt.prepare(prompt.snapshot()!, 'echo hi', () => {});
    expect(signal?.aborted).toBe(false);
    prompt.input();
    expect(signal?.aborted).toBe(true);
    reply.resolve('refused');
    expect(await operation).toBe('refused');
    await prompt.inspect();
    expect(prompt.snapshot()).not.toBeNull();
});

for (const outcome of ['inserted', 'refused', 'unconfirmed'] as const) {
    test(`preserves the editor's ${outcome} outcome`, async () => {
        const prompt = new ShellPrompt();
        prompt.connect({ inspect: async () => ({ cwd: '/work', empty: true }), prepare: async () => outcome, close() {} });
        await prompt.inspect();
        expect(await prompt.prepare(prompt.snapshot()!, 'echo hi', () => {})).toBe(outcome);
    });
}
