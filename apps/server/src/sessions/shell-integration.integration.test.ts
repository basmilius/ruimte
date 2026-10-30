import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareShellIntegration } from './shell-integration.ts';
import { SessionManager } from './manager.ts';
import { BunPtyAdapter } from '../pty/bun-pty.ts';
import { PrepareTerminal, shellSyntax } from './prepare-terminal.ts';
import { holdsForeground } from '../processes/foreground.ts';
import { waitFor, waitForAsync } from './test-helpers.ts';

for (const custom of [false, true]) {
    test.skipIf(process.platform === 'win32')(
        `a real zsh preserves ${custom ? 'custom ZDOTDIR' : 'HOME'} startup files and holds the prepared command until the person presses Enter`,
        async () => {
            const home = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-prepare-shell-')));
            const startup = custom ? join(home, 'person') : home;
            await mkdir(startup, { recursive: true });
            if (custom) {
                await writeFile(join(home, '.zshenv'), 'export RUIMTE_TEST_STARTUP=wrong\n');
            }
            const zshenv = 'export RUIMTE_TEST_STARTUP=kept\n';
            const zshrc = 'PS1="user prompt [%?]> "\n';
            const sentinel = join(home, 'only-after-enter');
            await writeFile(join(startup, '.zshenv'), zshenv);
            await writeFile(join(startup, '.zshrc'), zshrc);
            const manager = new SessionManager({
                adapter: new BunPtyAdapter(),
                shellEnvironment: await prepareShellIntegration(join(home, 'ruimte')),
                env: { HOME: home, PATH: '/usr/bin:/bin', SHELL: '/bin/zsh', ...(custom ? { ZDOTDIR: startup } : {}) }
            });
            manager.holdsForeground = holdsForeground;
            let output = '';
            manager.subscribe('person', (event) => {
                if (event.event === 'session.output') {
                    output += event.payload.data;
                }
            });
            try {
                await manager.create({ sessionId: 'shell', cwd: home, shell: '/bin/zsh', args: ['-i'], cols: 100, rows: 24 });
                await manager.attach('shell', 'person', 100, 24);
                const session = manager.get('shell')!;
                await waitForAsync(async () => (await session.shellPrompt.inspect())?.empty === true, 'the shell reporting its empty prompt', 1000).catch(
                    () => {
                        throw new Error(JSON.stringify(output));
                    }
                );
                expect(await session.plainText()).toContain('user prompt [0]>');
                const prepare = new PrepareTerminal({
                    machineId: 'owner',
                    machine: 'Test machine',
                    sessions: manager,
                    source: () => ({ cwd: home, projectId: 'project' }),
                    title: () => 'Test shell',
                    syntax: shellSyntax
                });
                const client = { id: 'person', send() {} };
                const command = `test "$RUIMTE_TEST_STARTUP" = kept && touch '${sentinel}'`;
                const preview = await prepare.preview('owner', { chatId: 'chat', itemId: 'reply', language: 'zsh', code: command }, client);
                expect(preview.targets).toHaveLength(1);
                await prepare.prepare('owner', preview.targets[0]!.token, client);
                await waitForAsync(async () => (await session.plainText()).includes('touch'), 'the shell showing the prepared line');
                await expect(access(sentinel)).rejects.toThrow();
                expect(await readFile(join(startup, '.zshenv'), 'utf8')).toBe(zshenv);
                expect(await readFile(join(startup, '.zshrc'), 'utf8')).toBe(zshrc);
                manager.write('shell', '\r', 'person');
                await waitForAsync(
                    () =>
                        access(sentinel).then(
                            () => true,
                            () => false
                        ),
                    'the explicit Enter executing the command'
                );
                manager.write('shell', 'false\r', 'person');
                await waitForAsync(async () => (await session.plainText()).includes('user prompt [1]>'), 'the prompt retaining the command exit status');
            } finally {
                manager.killAll();
                await waitFor(() => manager.list().every((session) => session.exited), 'test shell exiting');
                await rm(home, { recursive: true, force: true });
            }
        }
    );
}

test.skipIf(process.platform === 'win32')('cwd output without a controlling terminal preserves strict options, status and redirected streams', async () => {
    const home = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-cwd-no-tty-')));
    await writeFile(join(home, '.zshenv'), 'setopt errexit nounset errreturn\n');
    const env: Record<string, string> = { HOME: home, PATH: '/usr/bin:/bin', TERM_PROGRAM: 'ruimte-test' };
    const integrate = await prepareShellIntegration(join(home, 'ruimte'));
    integrate('/bin/zsh', env);
    const script = `
        if { : >/dev/tty; } 2>/dev/null; then exit 99; fi
        if (exit 37); then exit 98; else
            if _ruimte_output_cwd; then hook_status=0; else hook_status=$?; fi
        fi
        print -r -- "STATUS:$hook_status|OPTIONS:$options[errexit],$options[nounset],$options[errreturn]"
        print -r -- PERSON_STDOUT
        print -ru2 -- PERSON_STDERR
    `;
    // A new process session guarantees /dev/tty is unavailable, even when the test runner owns a PTY.
    const child = spawn('/bin/zsh', ['-c', script], { detached: true, cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
    });
    child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
    });
    try {
        const code = await new Promise<number | null>((resolve, reject) => {
            child.once('error', reject);
            child.once('close', resolve);
        });
        expect({ code, stdout, stderr }).toEqual({
            code: 0,
            stdout: 'STATUS:37|OPTIONS:on,on,on\nPERSON_STDOUT\n',
            stderr: 'PERSON_STDERR\n'
        });
    } finally {
        child.kill();
        await rm(home, { recursive: true, force: true });
    }
});

test.skipIf(process.platform === 'win32')(
    "a real bash with the Windows hook reports its cwd at every prompt and keeps the person's PROMPT_COMMAND",
    async () => {
        const home = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-bash-cwd-')));
        await writeFile(join(home, '.bashrc'), 'PROMPT_COMMAND="$PROMPT_COMMAND;printf PERSON_HOOK"\nPS1="person> "\n');
        const manager = new SessionManager({
            adapter: new BunPtyAdapter(),
            shellEnvironment: await prepareShellIntegration(join(home, 'ruimte'), 'win32'),
            env: { HOME: home, PATH: '/usr/bin:/bin', BASH_SILENCE_DEPRECATION_WARNING: '1' }
        });
        let output = '';
        manager.subscribe('person', (event) => {
            if (event.event === 'session.output') {
                output += event.payload.data;
            }
        });
        try {
            await manager.create({ sessionId: 'bash', cwd: home, shell: '/bin/bash', args: ['-i'], cols: 100, rows: 24 });
            await manager.attach('bash', 'person', 100, 24);
            await waitFor(() => output.includes(`\x1b]7;file://localhost${home}\x07PERSON_HOOK`), 'the first prompt reporting its cwd').catch(() => {
                throw new Error(JSON.stringify(output));
            });
            manager.write('bash', 'cd /\r', 'person');
            await waitFor(() => output.includes('\x1b]7;file://localhost/\x07PERSON_HOOK'), 'the prompt after cd reporting the new cwd');
        } finally {
            manager.killAll();
            await waitFor(() => manager.list().every((session) => session.exited), 'test shell exiting');
            await rm(home, { recursive: true, force: true });
        }
    }
);
