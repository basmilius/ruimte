import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BunPtyAdapter } from '../pty/bun-pty.ts';
import type { PtyProcess } from '../pty/pty.ts';
import { holdsForeground } from '../processes/foreground.ts';
import { SessionManager } from './manager.ts';
import { PrepareTerminal, shellSyntax } from './prepare-terminal.ts';
import { prepareShellIntegration } from './shell-integration.ts';
import { waitFor, waitForAsync } from './test-helpers.ts';

export async function realShell(rc: (home: string) => string = () => "PS1='editor> '\n", options: { zshenv?: string } = {}) {
    const home = await realpath(await mkdtemp('/tmp/ruimte-editor-test-'));
    await mkdir(join(home, 'other'));
    await writeFile(join(home, '.zshenv'), options.zshenv ?? '');
    await writeFile(join(home, '.zshrc'), rc(home));
    const adapter = new BunPtyAdapter();
    let pty: PtyProcess;
    let editorAddress = '';
    const manager = new SessionManager({
        adapter: {
            spawn(options) {
                editorAddress = options.env.RUIMTE_EDITOR_SOCKET!;
                pty = adapter.spawn(options);
                return pty;
            }
        },
        shellEnvironment: await prepareShellIntegration(join(home, 'ruimte')),
        // macOS's global zshrc reads TERM_PROGRAM even when the person's zshenv enabled nounset.
        env: { HOME: home, PATH: '/usr/bin:/bin', SHELL: '/bin/zsh', TERM_PROGRAM: 'ruimte-test' }
    });
    manager.holdsForeground = holdsForeground;
    let output = '';
    manager.subscribe('person', (event) => {
        if (event.event === 'session.output') {
            output += event.payload.data;
        }
    });
    await manager.create({ sessionId: 'shell', cwd: home, shell: '/bin/zsh', args: ['-i'], cols: 140, rows: 24 });
    await manager.attach('shell', 'person', 140, 24);
    const session = manager.get('shell')!;
    let cwd = home;
    const prepare = new PrepareTerminal({
        machineId: 'owner',
        machine: 'Remote build machine',
        sessions: manager,
        source: () => ({ cwd, projectId: 'project' }),
        title: () => 'Build shell',
        syntax: shellSyntax
    });
    const client = { id: 'person', send() {} };
    return {
        home,
        editorAddress,
        manager,
        session,
        prepare,
        client,
        setCwd(value: string) {
            cwd = value;
        },
        output: () => output,
        // Simulates bytes already in the tty, beyond the daemon's input invalidation boundary.
        queuedInput(data: string) {
            pty.write(data);
        },
        async ready() {
            await waitForAsync(async () => (await session.shellPrompt.inspect()) !== null, 'ZLE editor channel', 1000).catch(() => {
                throw new Error(JSON.stringify(output));
            });
        },
        preview(code = 'echo chosen > chosen') {
            return prepare.preview('owner', { chatId: 'chat', itemId: 'reply', language: 'zsh', code }, client);
        },
        async cleanup() {
            session.signal('SIGKILL');
            await waitFor(() => manager.list().every((entry) => entry.exited), 'fixture exit');
            await rm(home, { recursive: true, force: true });
        }
    };
}
