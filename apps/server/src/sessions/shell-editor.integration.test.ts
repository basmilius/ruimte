import { expect, test } from 'bun:test';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { holdsForeground } from '../processes/foreground';
import { realShell } from './shell-editor-test-helpers';
import { waitFor, waitForAsync } from './test-helpers';

function forged(cwd: string): string {
    return `printf '\\033]133;A\\007\\033]7;file://localhost${cwd}\\007forged prompt\\033]133;B\\007\\033[?2004h'`;
}

test('startup read plus forged OSC is never eligible and receives no command bytes', async () => {
    const f = await realShell((home) => `${forged(home)}\nread -k 1 value\nprint -r -- "$value" > '${home}/input-consumed'\nread -k 1 value\n`);
    try {
        await waitFor(() => f.output().includes('forged prompt'), 'startup read');
        expect(await holdsForeground(f.session.pid)).toBe(true);
        expect(await f.session.shellPrompt.workingDirectory()).toEqual({ state: 'unknown' });
        expect((await f.preview()).targets).toEqual([]);
        await expect(access(join(f.home, 'input-consumed'))).rejects.toThrow();
        f.manager.write('shell', 'X', 'person');
        await waitForAsync(() => Bun.file(join(f.home, 'input-consumed')).exists(), 'explicit input reaching read');
        expect(await readFile(join(f.home, 'input-consumed'), 'utf8')).toBe('X\n');
        await expect(access(join(f.home, 'chosen'))).rejects.toThrow();
    } finally {
        await f.cleanup();
    }
});

test('a prefilled zle-line-init buffer stays ineligible despite background OSC', async () => {
    const f = await realShell(
        (home) => `PS1='user> '\nzle-line-init() { BUFFER='echo prior; '; CURSOR=$#BUFFER; }\nzle -N zle-line-init\n{ sleep 0.1; ${forged(home)}; } &!\n`
    );
    try {
        await f.ready();
        await waitFor(() => f.output().includes('forged prompt'), 'background OSC');
        expect((await f.session.shellPrompt.inspect())?.empty).toBe(false);
        expect((await f.preview()).targets).toEqual([]);
        expect(await f.session.plainText()).toContain('echo prior;');
        expect(await f.session.plainText()).not.toContain('echo chosen');
        await expect(access(join(f.home, 'chosen'))).rejects.toThrow();
    } finally {
        await f.cleanup();
    }
});

test('cwd is read after late precmd hooks and the preview only offers that directory', async () => {
    const f = await realShell((home) => `PS1='user> '\nlate_cd() { cd '${home}/other'; }\nprecmd_functions+=(late_cd)\n`);
    try {
        await f.ready();
        const actual = join(f.home, 'other');
        expect(await f.session.shellPrompt.workingDirectory()).toMatchObject({ state: 'known', cwd: actual });
        expect((await f.preview()).targets).toEqual([]);
        f.setCwd(actual);
        const preview = await f.preview('pwd > actual-cwd');
        expect(preview.cwd).toBe(actual);
        expect(preview.targets).toHaveLength(1);
        expect(preview.targets[0]!.cwd).toBe(actual);
        await f.prepare.prepare('owner', preview.targets[0]!.token, f.client);
        // ZLE acknowledges insertion before it redraws the prepared line.
        await waitForAsync(async () => (await f.session.plainText()).includes('pwd > actual-cwd'), 'prepared line displayed');
        await expect(access(join(actual, 'actual-cwd'))).rejects.toThrow();
        f.manager.write('shell', '\r', 'person');
        await waitForAsync(() => Bun.file(join(actual, 'actual-cwd')).exists(), 'explicit Enter');
        expect((await readFile(join(actual, 'actual-cwd'), 'utf8')).trim()).toBe(actual);
    } finally {
        await f.cleanup();
    }
});

for (const change of ['buffer', 'cwd'] as const) {
    test(`ZLE repeats ${change} validation after preview, even without daemon input notification`, async () => {
        const f = await realShell(
            (home) =>
                `PS1='user> '\nrace_widget() { ${change === 'buffer' ? "BUFFER='echo prior; '; CURSOR=$#BUFFER" : `cd '${home}/other'`}; print -r -- changed > '${home}/changed'; }\nzle -N race_widget\nbindkey '^G' race_widget\n`
        );
        try {
            await f.ready();
            const preview = await f.preview();
            expect(preview.targets).toHaveLength(1);
            f.queuedInput('\x07');
            await waitForAsync(() => Bun.file(join(f.home, 'changed')).exists(), 'editor widget changing state');
            await expect(f.prepare.prepare('owner', preview.targets[0]!.token, f.client)).rejects.toThrow('refused the command');
            expect(await f.session.plainText()).not.toContain('echo chosen');
            if (change === 'buffer') {
                expect(await f.session.plainText()).toContain('echo prior;');
            }
            expect(await f.session.shellPrompt.workingDirectory()).toMatchObject({ state: 'known', cwd: change === 'cwd' ? join(f.home, 'other') : f.home });
        } finally {
            await f.cleanup();
        }
    });
}

test('a command queued during a blocking widget expires and cannot fill a later editor', async () => {
    const f = await realShell(
        (home) =>
            `PS1='user> '\nblocking_widget() { print -r -- started > '${home}/blocked'; sleep 1.2; print -r -- done > '${home}/unblocked'; }\nzle -N blocking_widget\nbindkey '^G' blocking_widget\n`
    );
    try {
        await f.ready();
        const preview = await f.preview();
        f.queuedInput('\x07');
        await waitForAsync(() => Bun.file(join(f.home, 'blocked')).exists(), 'blocking widget');
        // The foreground test is bypassed here to exercise the editor deadline itself.
        f.manager.holdsForeground = async () => true;
        await expect(f.prepare.prepare('owner', preview.targets[0]!.token, f.client)).rejects.toThrow();
        await waitForAsync(() => Bun.file(join(f.home, 'unblocked')).exists(), 'widget finishing');
        f.queuedInput('\r');
        await f.ready();
        expect((await f.session.shellPrompt.inspect())?.empty).toBe(true);
        expect(await f.session.plainText()).not.toContain('echo chosen');
        await expect(access(join(f.home, 'chosen'))).rejects.toThrow();
    } finally {
        await f.cleanup();
    }
});

test('a stale preview cannot follow the shell into a builtin read or a new prompt', async () => {
    const f = await realShell();
    try {
        await f.ready();
        const preview = await f.preview();
        f.queuedInput('read -k 1 value; print -r -- "$value" > consumed\r');
        await waitFor(() => f.session.shellPrompt.snapshot() === null, 'ZLE exit');
        expect(await f.session.shellPrompt.workingDirectory()).toEqual({ state: 'unknown' });
        await expect(f.prepare.prepare('owner', preview.targets[0]!.token, f.client)).rejects.toThrow();
        await expect(access(join(f.home, 'consumed'))).rejects.toThrow();
        f.manager.write('shell', 'X', 'person');
        await f.ready();
        expect(await readFile(join(f.home, 'consumed'), 'utf8')).toBe('X\n');
        const next = await f.preview();
        expect(next.targets).toHaveLength(1);
        const replies = await Promise.allSettled([
            f.prepare.prepare('owner', next.targets[0]!.token, f.client),
            f.prepare.prepare('owner', next.targets[0]!.token, f.client)
        ]);
        expect(replies.map((reply) => reply.status).sort()).toEqual(['fulfilled', 'rejected']);
        expect((await f.session.shellPrompt.inspect())?.empty).toBe(false);
        await expect(access(join(f.home, 'chosen'))).rejects.toThrow();
    } finally {
        await f.cleanup();
    }
});

for (const [command, context] of [
    ["printf '%s' '", 'cont'],
    ['vared -c editor_value', 'vared']
]) {
    test(`a secondary ZLE context cannot receive prepared input: ${context}`, async () => {
        const f = await realShell(
            (home) => `PS1='user> '
zle-line-init() { print -r -- "$CONTEXT" > '${home}/editor-context'; }
zle -N zle-line-init
`
        );
        try {
            await f.ready();
            f.manager.write('shell', command + '\r', 'person');
            await waitForAsync(async () => (await readFile(join(f.home, 'editor-context'), 'utf8')).trim() === context, 'secondary editor entering', 1000);
            expect(await f.session.shellPrompt.workingDirectory()).toEqual({ state: 'unknown' });
            expect((await f.preview()).targets).toEqual([]);
            expect(await f.session.plainText()).not.toContain('echo chosen');
        } finally {
            await f.cleanup();
        }
    });
}

test('an unauthenticated socket peer cannot replace the session editor', async () => {
    const f = await realShell();
    try {
        await f.ready();
        const before = await f.session.shellPrompt.inspect();
        let closed = false;
        const peer = await Bun.connect({
            unix: f.editorAddress,
            socket: {
                open(socket) {
                    socket.write(`hello\tforged-secret\t${f.session.pid}\n`);
                },
                data() {},
                close() {
                    closed = true;
                },
                error() {
                    closed = true;
                }
            }
        });
        try {
            await waitFor(() => closed, 'unauthenticated peer closing', 1000);
            expect(await f.session.shellPrompt.inspect()).toEqual(before);
            expect((await f.preview()).targets).toHaveLength(1);
            expect(await f.session.plainText()).not.toContain('echo chosen');
        } finally {
            peer.terminate();
        }
    } finally {
        await f.cleanup();
    }
});

test('clearing used input restores eligibility only after a fresh editor inspection', async () => {
    const f = await realShell();
    try {
        await f.ready();
        f.manager.write('shell', 'my input', 'person');
        await waitForAsync(async () => (await f.session.shellPrompt.inspect())?.empty === false, 'occupied editor');
        expect((await f.preview()).targets).toEqual([]);
        f.manager.write('shell', '\x15', 'person');
        await waitForAsync(async () => (await f.session.shellPrompt.inspect())?.empty === true, 'cleared editor');
        const preview = await f.preview();
        expect(preview.targets).toHaveLength(1);
        await f.prepare.prepare('owner', preview.targets[0]!.token, f.client);
        expect((await f.session.shellPrompt.inspect())?.empty).toBe(false);
        expect(await f.session.plainText()).toContain('echo chosen > chosen');
        await expect(access(join(f.home, 'chosen'))).rejects.toThrow();
    } finally {
        await f.cleanup();
    }
});
