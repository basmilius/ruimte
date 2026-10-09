import { expect, test } from 'bun:test';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { withBrowserFixture, clientDirectory } from '../../../client/testing/browser-fixture';
import { realShell } from './shell-editor-test-helpers';
import { waitForAsync } from './test-helpers';
import { PrepareTerminal, shellSyntax } from './prepare-terminal';
import { hasPrepareSource } from './prepare-source';
import { Dispatcher } from '../dispatcher';
import { registerTerminalPrepareHandlers } from '../handlers/terminal-prepare';

for (const change of ['none', 'busy', 'input', 'refused', 'lost-ack', 'lost-ack-nl'] as const) {
    test(`real Markdown → workspace host → person action → remote owner → ZLE revalidates ${change}`, async () => {
        const lostAck = change.startsWith('lost-ack');
        const f = await realShell(() =>
            lostAck ? `PS1='ack> '\nprint() { if [[ "$*" == *$'\\tprepared' ]]; then return 0; fi; builtin print "$@"; }\n` : "PS1='editor> '\n"
        );
        const command = 'printf "%s" "héllo" > chosen';
        const markdown = '```bash\n' + command + '\n```';
        const calls: string[] = [];
        await f.ready();
        const dispatcher = new Dispatcher();
        registerTerminalPrepareHandlers(
            dispatcher,
            new PrepareTerminal({
                machineId: 'owner',
                machine: 'Remote build machine',
                sessions: f.manager,
                source: (source) =>
                    source.chatId === 'chat' &&
                    hasPrepareSource({ kind: 'assistant', id: 'reply', createdAt: 0, turnId: null, streaming: false, text: markdown }, source)
                        ? { cwd: f.home, projectId: 'project' }
                        : null,
                title: () => 'Build shell',
                syntax: shellSyntax
            })
        );
        const server = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            async fetch(request) {
                const raw = await request.text();
                calls.push(JSON.parse(raw).type);
                let reply: unknown;
                await dispatcher.handle(
                    {
                        id: 'person',
                        send: (frame) => {
                            reply = frame;
                        }
                    },
                    raw
                );
                return Response.json(reply, { headers: { 'Access-Control-Allow-Origin': '*' } });
            }
        });
        try {
            await withBrowserFixture(
                `
                import { connectWorkspaceChatHost } from ${JSON.stringify(join(clientDirectory, 'src/chat/workspace-host.ts'))};
                import { setChatHost } from ${JSON.stringify(join(clientDirectory, 'node_modules/@adecore/agents-react/src/host.ts'))};
                import { ChatScopeContext } from ${JSON.stringify(join(clientDirectory, 'node_modules/@adecore/agents-react/src/scope.ts'))};
                import { AssistantRow } from ${JSON.stringify(join(clientDirectory, 'node_modules/@adecore/agents-react/src/chat/ui/rows/MessageRows.tsx'))};
                import { terminalPrepareActions } from ${JSON.stringify(join(clientDirectory, 'src/actions/terminal-prepare-actions.ts'))};
                import { clientActions } from ${JSON.stringify(join(clientDirectory, 'src/actions/client-actions.ts'))};
                import { TransportError } from ${JSON.stringify(join(clientDirectory, 'src/transport/transport.ts'))};
                import { ActionRegistry } from ${JSON.stringify(join(clientDirectory, '../../packages/actions/src/index.ts'))};
                import { useEndpoints } from ${JSON.stringify(join(clientDirectory, 'src/state/endpoints.ts'))};
                import words from ${JSON.stringify(join(clientDirectory, 'src/i18n/locales/en/chat.json'))};
                import dutch from ${JSON.stringify(join(clientDirectory, 'src/i18n/locales/nl/chat.json'))};
                i18next.addResourceBundle('en', 'chat', words, true, true);
                i18next.addResourceBundle('nl', 'chat', dutch, true, true);
                window.changeLanguage = language => i18next.changeLanguage(language);
                window.pasteButton = () => [...document.querySelectorAll('button')].find(button => button.textContent === i18next.t('chat:prepare.paste'));
                useEndpoints.setState({ endpoints: [{ id: 'remote', daemonId: 'owner', label: 'Remote build machine' }], activeId: 'local' });
                window.pending = Promise.resolve();
                const transport = { status: 'open', request(type, payload) {
                    const work = fetch('http://127.0.0.1:${server.port}', { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), type, payload }) })
                        .then(response => response.json()).then(reply => { if (!reply.ok) throw new TransportError(reply.error.code, reply.error.message); return reply.result; });
                    window.pending = work.catch(() => {}); return work;
                }};
                const registry = new ActionRegistry(terminalPrepareActions({ machineId: id => id === 'remote' ? 'owner' : null, transport: id => id === 'remote' ? transport : null }));
                clientActions.execute = registry.execute.bind(registry);
                connectWorkspaceChatHost();
                setChatHost({ useStreaming: () => 'blocks' });
                const scope = { id: 'remote', keyOf: id => 'remote/'+id, owns: key => key.startsWith('remote/'), transport, chats: {} };
                const root = createRoot(document.getElementById('root'));
                window.draw = (streaming, text = ${JSON.stringify(markdown)}) => root.render(
                    <UIProvider i18n={i18next}><ChatScopeContext.Provider value={scope}>
                        <AssistantRow chatId="chat" item={{ id:'reply', kind:'assistant', turnId:null, createdAt:0, streaming, text }}/>
                    </ChatScopeContext.Provider></UIProvider>
                );
                window.prepareButton = () => document.querySelector('button[aria-label="Prepare in terminal"]');
                window.draw(true);
            `,
                '.invisible{visibility:hidden}svg{width:14px;height:14px}',
                async (view) => {
                    const frame = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))';
                    expect(calls).toEqual([]);
                    expect(await view.evaluate<boolean>('!!window.prepareButton()')).toBe(false);
                    await view.evaluate('window.draw(false, "```bash\\nprintf unfinished")');
                    await view.evaluate(frame);
                    expect(await view.evaluate<boolean>('!!window.prepareButton()')).toBe(false);
                    await view.evaluate('window.draw(false)');
                    await view.evaluate(frame);
                    expect(await view.evaluate<boolean>('!!window.prepareButton()')).toBe(true);
                    expect(await view.evaluate<boolean>('window.prepareButton().closest(".invisible") === null')).toBe(true);
                    expect(calls).toEqual([]);
                    expect((await f.session.shellPrompt.inspect())?.empty).toBe(true);
                    await view.evaluate('window.prepareButton().click()');
                    await view.evaluate('window.pending');
                    await view.evaluate(frame);
                    expect(await view.evaluate<string>('document.querySelector("[role=dialog]").textContent')).toContain('Remote build machine');
                    expect(await view.evaluate<string>('document.querySelector("[role=dialog]").textContent')).toContain(f.home);
                    expect(await view.evaluate<string>('document.querySelector("[role=dialog] pre").textContent')).toBe(command);
                    expect((await f.session.shellPrompt.inspect())?.empty).toBe(true);
                    await expect(access(join(f.home, 'chosen'))).rejects.toThrow();
                    if (change === 'busy') {
                        f.manager.holdsForeground = async () => false;
                    }
                    if (change === 'input') {
                        f.manager.write('shell', 'my existing input', 'person');
                    }
                    if (change === 'refused') {
                        f.queuedInput('prior input');
                        await waitForAsync(async () => (await f.session.plainText()).includes('prior input'), 'occupied buffer behind server observation');
                    }
                    if (change === 'lost-ack-nl') {
                        await view.evaluate('window.changeLanguage("nl")');
                        await view.evaluate(frame);
                    }
                    await view.evaluate('window.pasteButton().click()');
                    await view.evaluate('window.pending');
                    await view.evaluate(frame);
                    expect(calls).toEqual(['session.preparePreview', 'session.prepare']);
                    const screen = await f.session.plainText();
                    if (change === 'none' || lostAck) {
                        expect(screen).toContain(command);
                        if (!lostAck) {
                            expect((await f.session.shellPrompt.inspect())?.empty).toBe(false);
                        } else {
                            expect(await view.evaluate<string>('document.querySelector("[role=alert]").textContent')).toContain(
                                change === 'lost-ack-nl' ? 'De opdracht staat mogelijk al in de terminal' : 'The command may already be in the terminal'
                            );
                            expect(await view.evaluate<boolean>('window.pasteButton().disabled')).toBe(true);
                            await view.evaluate('window.pasteButton().click()');
                            expect(calls).toEqual(['session.preparePreview', 'session.prepare']);
                        }
                    } else {
                        expect(screen).not.toContain(command);
                        if (change === 'input') {
                            expect(screen).toContain('my existing input');
                        }
                        expect(await view.evaluate<string>('document.querySelector("[role=alert]").textContent')).toContain(
                            change === 'refused' ? 'Nothing was inserted' : 'Nothing was pasted'
                        );
                    }
                    await expect(access(join(f.home, 'chosen'))).rejects.toThrow();
                    expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
                }
            );
        } finally {
            await server.stop(true);
            await f.cleanup();
        }
    });
}
