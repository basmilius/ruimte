import { expect, test } from 'bun:test';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PROTOCOL_VERSION, type ProjectView } from '@ruimte/contracts';
import { clientDirectory, withBrowserFixture } from '../../../client/testing/browser-fixture.ts';
import { realShell } from './shell-editor-test-helpers.ts';
import { Dispatcher } from '../dispatcher.ts';
import { registerSessionHandlers } from '../handlers/session.ts';
import { projectTerminalPrepareHost, registerTerminalPrepareHandlers } from '../handlers/terminal-prepare.ts';
import { ProjectIndex } from '../projects/project-index.ts';
import { PrepareTerminal, shellSyntax } from './prepare-terminal.ts';
import { waitForAsync } from './test-helpers.ts';

const source = (path: string): string => JSON.stringify(join(clientDirectory, 'src', path));
const command = 'printf chosen > chosen';

for (const mode of [
    'canvas',
    'view',
    'group',
    'other-canvas',
    'cancel',
    'refused',
    'unconfirmed',
    'workspace',
    'machine',
    'workspace-before',
    'machine-before',
    'machine-return',
    'removed',
    'replaced',
    'nonempty',
    'wrong-cwd',
    'wrong-project',
    'closed',
    'busy'
] as const) {
    test(`real canvas/view preview and destination focus: ${mode}`, async () => {
        const delayed = ['workspace', 'machine', 'removed', 'replaced'].includes(mode);
        const answered = Promise.withResolvers<void>();
        let inserted = false;
        const targetId = mode === 'view' ? 'view-shell' : 'canvas-shell';
        const shell = await realShell(() =>
            mode === 'unconfirmed' ? `PS1='ack> '\nprint() { if [[ "$*" == *$'\\tprepared' ]]; then return 0; fi; builtin print "$@"; }\n` : "PS1='editor> '\n"
        );
        const index = new ProjectIndex();
        const dispatcher = new Dispatcher();
        const views: ProjectView[] = [
            {
                id: 'canvas',
                kind: 'canvas',
                name: 'Canvas',
                nodes: [{ id: 'canvas-shell', kind: 'terminal', title: 'Canvas shell', x: 30, y: 30, w: 600, h: 300 }],
                edges: [],
                texts: [],
                layouts: []
            },
            { id: 'view-shell', kind: 'terminal', name: 'View shell', node: {} },
            { id: 'chat', kind: 'chat', name: 'Chat', node: {} },
            { id: 'other-canvas', kind: 'canvas', name: 'Other canvas', nodes: [], edges: [], texts: [], layouts: [] }
        ];
        if (mode === 'group' && views[0]?.kind === 'canvas') {
            views[0].nodes.unshift({ id: 'group', kind: 'group', title: 'Group', x: 0, y: 0, w: 700, h: 400 });
        }
        index.set('project', shell.home, { views });
        const prepare = new PrepareTerminal({
            machineId: 'owner',
            machine: 'Owner',
            sessions: shell.manager,
            syntax: shellSyntax,
            ...projectTerminalPrepareHost(index, {
                get: () => ({
                    info: { cwd: shell.home },
                    thread: {
                        get: () => ({ kind: 'assistant', id: 'reply', createdAt: 0, turnId: null, streaming: false, text: '```sh\n' + command + '\n```' })
                    }
                })
            })
        });
        registerSessionHandlers(dispatcher, shell.manager);
        registerTerminalPrepareHandlers(dispatcher, prepare);
        const calls: string[] = [];
        let person = '';
        const server = Bun.serve<{ id: string; off?: () => void }>({
            hostname: '127.0.0.1',
            port: 0,
            fetch(request, server) {
                return server.upgrade(request, { data: { id: crypto.randomUUID() } }) ? undefined : new Response('WebSocket only', { status: 400 });
            },
            websocket: {
                open(socket) {
                    person = socket.data.id;
                    socket.data.off = shell.manager.subscribe(person, (event) => socket.send(JSON.stringify({ type: 'event', ...event })));
                },
                async message(socket, message) {
                    const raw = String(message);
                    const request = JSON.parse(raw) as { id: string; type: string };
                    calls.push(request.type);
                    if (request.type === 'endpoint.info') {
                        socket.send(JSON.stringify({ id: request.id, ok: true, result: { protocol: PROTOCOL_VERSION } }));
                        return;
                    }
                    let reply: unknown;
                    await dispatcher.handle(
                        {
                            id: socket.data.id,
                            send: (frame) => {
                                reply = frame;
                            }
                        },
                        raw
                    );
                    if (delayed && request.type === 'session.prepare') {
                        inserted = true;
                        await answered.promise;
                    }
                    socket.send(JSON.stringify(reply));
                },
                close(socket) {
                    socket.data.off?.();
                    shell.manager.detachAll(socket.data.id);
                }
            }
        });
        try {
            const css = await readFile(join(clientDirectory, 'node_modules/@xterm/xterm/css/xterm.css'), 'utf8');
            await withBrowserFixture(
                `
            import { connectWorkspaceChatHost } from ${source('chat/workspace-host.ts')};
            import { setChatHost } from ${JSON.stringify(join(clientDirectory, 'node_modules/@adecore/agents-react/src/host.ts'))};
            import { AssistantRow } from ${JSON.stringify(join(clientDirectory, 'node_modules/@adecore/agents-react/src/chat/ui/rows/MessageRows.tsx'))};
            import { clientActions } from ${source('actions/client-actions.ts')};
            import { terminalPrepareActions } from ${source('actions/terminal-prepare-actions.ts')};
            import { ActionRegistry } from ${JSON.stringify(join(clientDirectory, '../../packages/actions/src/index.ts'))};
            import { focusedCanvas } from ${source('state/canvas.ts')};
            import chatWords from ${source('i18n/locales/en/chat.json')};
            import { ViewHost } from ${source('shell/ViewHost.tsx')};
            import { WebSocketTransport } from ${source('transport/websocket-transport.ts')};
            import { SessionClient } from ${source('terminal/session-client.ts')};
            import { sessionSinkFor } from ${source('state/sessions.ts')};
            import { useWindow } from ${source('state/window.ts')};
            import { useProject } from ${source('state/project.ts')};
            import { useDocument } from ${source('state/document.ts')};
            import { useEndpoints } from ${source('state/endpoints.ts')};
            import { machineFor } from ${source('transport/connections.ts')};
            import { ConnectionContext } from ${source('transport/context.ts')};
            import { ChatScopeProvider } from ${source('transport/ChatScopeProvider.tsx')};
            import words from ${source('i18n/locales/en/canvas.json')};
            i18next.addResourceBundle('en', 'canvas', words, true, true);
            useEndpoints.setState({activeId:'local',endpoints:[{id:'local',label:'Local'},{id:'remote',daemonId:'owner',label:'Owner'}]});
            useWindow.getState().show({kind:'workspace',workspace:{connection:{endpointId:'remote'}}});
            useProject.setState({current:{folder:${JSON.stringify(shell.home)},projectId:'project'},currentEndpointId:'remote'});
            useDocument.getState().load({version:3,rev:1,name:'Prepare',color:'#000',views:${JSON.stringify(views)}},null);
            const wire = new WebSocketTransport('ws://127.0.0.1:${server.port}'); window.wire=wire;
            await new Promise(resolve=>{const off=wire.subscribeStatus(status=>{if(status==='open'){off();resolve()}})});
            const machine=machineFor('remote');machine.transport=wire;machine.sessions=new SessionClient(wire,sessionSinkFor('remote'));
            useWindow.getState().show({kind:'workspace',workspace:{connection:machine}});
            const original=clientActions.execute.bind(clientActions);
            const prepareRegistry=new ActionRegistry(terminalPrepareActions({machineId:()=> 'owner',transport:()=>wire}));
            clientActions.execute=(name,...args)=>name.startsWith('terminal.prepare')?prepareRegistry.execute(name,...args):original(name,...args);
            const request=wire.request.bind(wire);wire.request=async(type,payload)=>{const result=await request(type,payload);if(type==='session.preparePreview')window.lastPreview=result;return result};
            i18next.addResourceBundle('en','chat',chatWords,true,true);connectWorkspaceChatHost();setChatHost({useStreaming:()=> 'blocks'});
            window.documentStore=useDocument;window.canvas=focusedCanvas;window.projectStore=useProject;window.windowStore=useWindow;window.endpoints=useEndpoints;
            window.clickPrepare=()=>{const button=document.querySelector('button[aria-label="Prepare in terminal"]');button.focus();button.click()};
            window.cancelPrepare=()=>[...document.querySelectorAll("[role=dialog] button")].find(button=>button.textContent===i18next.t("common:action.cancel")).click();
            window.clickPaste=()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent==='Paste without Enter');button.focus();button.click()};
            createRoot(document.getElementById('root')).render(<UIProvider i18n={i18next}><ConnectionContext.Provider value={machine}><ChatScopeProvider><ViewHost/><div className="assistant"><AssistantRow chatId="chat" item={{id:"reply",kind:"assistant",createdAt:0,turnId:null,streaming:false,text:${JSON.stringify('```sh\n' + command + '\n```')}}}/></div></ChatScopeProvider></ConnectionContext.Provider></UIProvider>);
        `,
                css +
                    `.absolute{position:absolute}.relative{position:relative}.inset-0{inset:0}.flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1}.grow{flex-grow:1}.h-full{height:100%}.w-full{width:100%}.min-h-0{min-height:0}.min-w-0{min-width:0}.invisible{visibility:hidden}.assistant{position:absolute;right:0;bottom:0;width:300px;background:var(--color-surface);z-index:100}svg{width:14px;height:14px}`,
                async (view) => {
                    await waitForAsync(async () => (await shell.manager.get('canvas-shell')?.shellPrompt.inspect())?.empty === true, 'fresh canvas editor');
                    const preview = () =>
                        prepare.preview('owner', { chatId: 'chat', itemId: 'reply', language: 'sh', code: command }, { id: person, send() {} });
                    const canvas = await preview();
                    expect(canvas.targets.map((target) => target.sessionId)).toContain('canvas-shell');
                    await view.evaluate("window.documentStore.getState().setActiveView('view-shell')");
                    await waitForAsync(async () => (await shell.manager.get('view-shell')?.shellPrompt.inspect())?.empty === true, 'fresh view editor');
                    if (mode === 'view') {
                        await view.evaluate("window.documentStore.getState().setActiveView('canvas')");
                    }
                    if (mode === 'other-canvas') {
                        await view.evaluate("window.documentStore.getState().setActiveView('other-canvas')");
                    }
                    if (['nonempty', 'wrong-cwd', 'busy'].includes(mode)) {
                        await shell.manager.attach('canvas-shell', person);
                        shell.manager.write('canvas-shell', mode === 'nonempty' ? 'prior input' : mode === 'wrong-cwd' ? 'cd other\r' : 'sleep 60\r', person);
                        await waitForAsync(
                            async () =>
                                mode === 'nonempty'
                                    ? (await shell.manager.get('canvas-shell')!.plainText()).includes('prior input')
                                    : mode === 'wrong-cwd'
                                      ? (await shell.manager.get('canvas-shell')!.shellPrompt.workingDirectory()).state === 'known' &&
                                        shell.manager.get('canvas-shell')!.shellPrompt.snapshot()?.cwd === join(shell.home, 'other')
                                      : (await shell.manager.holdsForeground(shell.manager.get('canvas-shell')!.pid)) === false,
                            'changed terminal state'
                        );
                        shell.manager.detach('canvas-shell', person);
                    }
                    if (mode === 'wrong-project') {
                        index.set('project', shell.home, { views: views.filter((view) => view.id !== 'canvas') });
                        index.set('other-project', shell.home, { views: [views[0]!] });
                    }
                    if (mode === 'closed') {
                        await shell.manager.kill('canvas-shell');
                    }
                    expect(index.locate('canvas-shell')?.projectId).toBe(mode === 'wrong-project' ? 'other-project' : 'project');
                    if (!['nonempty', 'wrong-cwd', 'wrong-project', 'closed', 'busy'].includes(mode)) {
                        expect((await shell.manager.get('canvas-shell')!.shellPrompt.inspect())?.empty).toBe(true);
                    }
                    await view.evaluate('window.clickPrepare()');
                    await waitForAsync(
                        async () => await view.evaluate<boolean>('!!window.lastPreview && !!document.querySelector("[role=dialog] input")'),
                        'preview with destinations'
                    );
                    const after = await view.evaluate<Awaited<ReturnType<typeof preview>>>('window.lastPreview');
                    expect(after.targets.map((target) => target.sessionId)).toContain('view-shell');
                    if (['nonempty', 'wrong-cwd', 'wrong-project', 'closed', 'busy'].includes(mode)) {
                        expect(after.targets.map((target) => target.sessionId)).not.toContain('canvas-shell');
                        expect(calls).not.toContain('session.write');
                        return;
                    }
                    expect(after.targets.map((target) => target.sessionId)).toContain('canvas-shell');
                    expect(calls).not.toContain('session.write');
                    const beforeView = await view.evaluate<string>('window.documentStore.getState().activeViewId');
                    if (mode === 'cancel') {
                        await view.evaluate('window.cancelPrepare()');
                        await waitForAsync(async () => await view.evaluate<boolean>('!document.querySelector("[role=dialog]")'), 'cancelled dialog');
                        expect(await view.evaluate<string>('window.documentStore.getState().activeViewId')).toBe(beforeView);
                        expect(calls).not.toContain('session.prepare');
                        await waitForAsync(async () => !shell.manager.get('canvas-shell')!.isAttached(person), 'preview follow released');
                        expect(shell.manager.get('view-shell')!.isAttached(person)).toBe(true);
                        return;
                    }
                    if (mode === 'workspace-before' || mode === 'machine-before' || mode === 'machine-return') {
                        await view.evaluate(
                            mode === 'workspace-before'
                                ? 'window.windowStore.getState().show({kind:"start"})'
                                : 'window.endpoints.setState({endpoints:[{id:"remote",daemonId:"replacement",label:"Replacement"}]})'
                        );
                        if (mode === 'machine-return') {
                            await view.evaluate('window.endpoints.setState({endpoints:[{id:"remote",daemonId:"owner",label:"Owner"}]})');
                        }
                        await view.evaluate('window.clickPaste()');
                        await waitForAsync(async () => await view.evaluate<boolean>('!document.querySelector("[role=dialog]")'), 'stale preview closes');
                        expect(calls).not.toContain('session.prepare');
                        expect(await view.evaluate<string>('window.documentStore.getState().activeViewId')).toBe(beforeView);
                        expect(await view.evaluate<boolean>('document.activeElement?.classList.contains("xterm-helper-textarea")')).toBe(false);
                        expect(await view.evaluate<boolean>('document.activeElement?.closest(".assistant") === null')).toBe(true);
                        return;
                    }
                    if (mode === 'refused') {
                        shell.manager.write('canvas-shell', 'prior input', person);
                    }
                    await view.evaluate(
                        `document.querySelector('input[value="${after.targets.find((target) => target.sessionId === targetId)!.token}"]').click()`
                    );
                    await view.evaluate('window.clickPaste()');
                    if (delayed) {
                        await waitForAsync(async () => inserted, 'server inserted before reply');
                        if (mode === 'workspace') {
                            await view.evaluate('(()=>{window.windowStore.getState().show({kind:"start"});window.projectStore.setState({current:null});})()');
                        }
                        if (mode === 'machine') {
                            await view.evaluate('window.endpoints.setState({endpoints:[{id:"remote",daemonId:"replacement",label:"Replacement"}]})');
                        }
                        if (mode === 'removed') {
                            await view.evaluate('window.documentStore.getState().deleteView("canvas")');
                        }
                        if (mode === 'replaced') {
                            await shell.manager.kill('canvas-shell');
                            await waitForAsync(
                                async () => !shell.manager.get('canvas-shell') || shell.manager.get('canvas-shell')!.exited,
                                'replaced session exiting'
                            );
                            await shell.manager.create({ sessionId: 'canvas-shell', cwd: shell.home, cols: 80, rows: 24 });
                        }
                        answered.resolve();
                        await waitForAsync(async () => await view.evaluate<boolean>('!document.querySelector("[role=dialog]")'), 'stale success closes');
                        expect(await view.evaluate<string>('window.documentStore.getState().activeViewId')).toBe(beforeView);
                        expect(await view.evaluate<boolean>('document.activeElement?.classList.contains("xterm-helper-textarea")')).toBe(false);
                        expect(await view.evaluate<boolean>('document.activeElement?.closest(".assistant") === null')).toBe(true);
                        expect(calls).not.toContain('session.write');
                        return;
                    }
                    if (mode === 'refused' || mode === 'unconfirmed') {
                        await waitForAsync(
                            async () => await view.evaluate<boolean>('!!document.querySelector("[role=dialog] [role=alert]")'),
                            'refused or uncertain dialog'
                        );
                        expect(await view.evaluate<string>('window.documentStore.getState().activeViewId')).toBe(beforeView);
                        expect(await view.evaluate<boolean>('document.activeElement?.classList.contains("xterm-helper-textarea")')).toBe(false);
                        expect(await view.evaluate<boolean>('document.activeElement?.closest(".assistant") === null')).toBe(true);
                        expect(await view.evaluate<string>('document.querySelector("[role=dialog] [role=alert]").textContent')).toContain(
                            mode === 'unconfirmed' ? 'may already be in the terminal' : 'Nothing was pasted'
                        );
                        expect(await shell.manager.get('canvas-shell')!.plainText()).toContain(mode === 'refused' ? 'prior input' : command);
                        await expect(access(join(shell.home, 'chosen'))).rejects.toThrow();
                        expect(calls).not.toContain('session.write');
                        return;
                    }
                    await waitForAsync(
                        async () =>
                            await view.evaluate<boolean>(
                                '!document.querySelector("[role=dialog]") && document.activeElement?.classList.contains("xterm-helper-textarea")'
                            ),
                        'chosen xterm keyboard focus'
                    );
                    expect(await view.evaluate<string>('window.documentStore.getState().activeViewId')).toBe(mode === 'view' ? 'view-shell' : 'canvas');
                    if (mode !== 'view') {
                        expect(await view.evaluate<string[]>('window.canvas().getState().selection')).toEqual(['canvas-shell']);
                        expect(await view.evaluate<string>('window.canvas().getState().bodyFocusId')).toBe('canvas-shell');
                    }
                    expect(await shell.manager.get(targetId)!.plainText()).toContain(command);
                    await expect(access(join(shell.home, 'chosen'))).rejects.toThrow();
                    expect(calls).not.toContain('session.write');
                    await view.evaluate(
                        'document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:true}))'
                    );
                    await waitForAsync(() => Bun.file(join(shell.home, 'chosen')).exists(), 'execution after explicit Enter');
                    expect(await readFile(join(shell.home, 'chosen'), 'utf8')).toBe('chosen');
                }
            );
        } finally {
            await server.stop(true);
            shell.manager.killAll();
            await waitForAsync(async () => shell.manager.list().every((session) => session.exited), 'shell exits');
            await shell.cleanup();
        }
    });
}
