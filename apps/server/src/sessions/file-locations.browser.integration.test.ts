import { expect, test } from 'bun:test';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PROTOCOL_VERSION } from '@ruimte/contracts';
import { clientDirectory, withBrowserFixture } from '../../../client/testing/browser-fixture.ts';
import { realShell } from './shell-editor-test-helpers.ts';
import { Dispatcher } from '../dispatcher.ts';
import { registerSessionHandlers } from '../handlers/session.ts';
import { waitFor } from './test-helpers.ts';
import { SnapshotStore } from './snapshot-store.ts';
import { SessionManager } from './manager.ts';
import { prepareShellIntegration } from './shell-integration.ts';
import { BunPtyAdapter } from '../pty/bun-pty.ts';

type View = InstanceType<typeof Bun.WebView>;
const frame = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))';
const source = (path: string): string => JSON.stringify(join(clientDirectory, 'src', path));

for (const mode of [
    'live',
    'reconnect',
    'restore',
    'late-precmd',
    'escaped-cwd',
    'strict-zshenv',
    'strict-zshrc',
    'redirected-cd-stdout-click',
    'redirected-cd-stdout-menu',
    'redirected-cd-both-click',
    'redirected-cd-both-menu',
    'redirected-block-click',
    'redirected-block-menu',
    'redirected-function-click',
    'redirected-function-menu',
    'subshell-tostop-click',
    'subshell-tostop-menu'
] as const) {
    test(`real zsh output opens the right same.ts through preview click and menu: ${mode}`, async () => {
        const shell = await realShell(
            (home) =>
                `PS1='editor> '\n${mode === 'strict-zshrc' ? 'setopt errexit nounset\n' : ''}${mode === 'late-precmd' ? `late_cd() { if [[ -e '${home}/change-next' ]]; then print -r -- 'BEFORE same.ts:12:4-16'; cd '${home}/nested'; print -r -- 'AFTER same.ts:12:4-16'; rm '${home}/change-next'; fi; }; precmd_functions+=(late_cd)\n` : ''}`,
            { zshenv: mode === 'strict-zshenv' ? 'setopt errexit nounset\n' : '' }
        );
        const nestedName = mode === 'escaped-cwd' ? 'nested % # ? \\ 例 ' : 'nested';
        await mkdir(join(shell.home, nestedName));
        const files = [join(shell.home, 'same.ts'), join(shell.home, nestedName, 'same.ts')];
        for (const [index, path] of files.entries()) {
            await writeFile(path, Array.from({ length: 30 }, (_, line) => `${index === 0 ? 'ROOT' : 'NESTED'} line ${line + 1}`).join('\n'));
        }
        await writeFile(join(shell.home, '.editorconfig'), '[*]\nindent_style = space\n');
        await writeFile(join(shell.home, nestedName, '.editorconfig'), '');
        await shell.ready();
        let manager = shell.manager;
        const restarted: SessionManager[] = [];
        let dispatcher: Dispatcher;
        const reads: string[] = [];
        let attaches = 0;
        let stopping = false;
        // Handlers consult the current manager so a daemon restart uses a new Session and SnapshotStore.
        const register = (): void => {
            dispatcher = new Dispatcher();
            registerSessionHandlers(dispatcher, manager);
            dispatcher.register('fs.read', async ({ path }) => {
                reads.push(path);
                const text = await readFile(path, 'utf8');
                return { kind: 'text' as const, text, encoding: 'utf-8' as const, size: Buffer.byteLength(text), mtime: 1 };
            });
            dispatcher.register('git.worktree-list', () => ({ worktrees: [] }));
        };
        register();
        const server = Bun.serve<{ id: string; off?: () => void }>({
            hostname: '127.0.0.1',
            port: 0,
            fetch(request, server) {
                return server.upgrade(request, { data: { id: crypto.randomUUID() } }) ? undefined : new Response('WebSocket only', { status: 400 });
            },
            websocket: {
                open(socket) {
                    socket.data.off = manager.subscribe(socket.data.id, (event) => {
                        if (!stopping) {
                            socket.send(JSON.stringify({ type: 'event', ...event }));
                        }
                    });
                },
                async message(socket, message) {
                    const raw = String(message);
                    const request = JSON.parse(raw) as { id: string; type: string };
                    if (request.type === 'endpoint.info') {
                        socket.send(JSON.stringify({ id: request.id, ok: true, result: { protocol: PROTOCOL_VERSION } }));
                        return;
                    }
                    if (request.type === 'session.attach') {
                        attaches++;
                    }
                    await dispatcher.handle({ id: socket.data.id, send: (frame) => socket.send(JSON.stringify(frame)) }, raw);
                },
                close(socket) {
                    socket.data.off?.();
                    manager.detachAll(socket.data.id);
                }
            }
        });
        try {
            const css = await readFile(join(clientDirectory, 'node_modules/@xterm/xterm/css/xterm.css'), 'utf8');
            const terminalCss = await readFile(join(clientDirectory, 'node_modules/@adecore/terminal/src/terminal.css'), 'utf8');
            await withBrowserFixture(
                `
                import { Terminal } from ${JSON.stringify(Bun.resolveSync('@xterm/xterm', await realpath(join(clientDirectory, 'node_modules/@adecore/terminal'))))};
                import { TerminalBody } from ${source('nodes/TerminalBody.tsx')};
                import { FileBody } from ${source('shell/panels/FileBody.tsx')};
                import { WebSocketTransport } from ${source('transport/websocket-transport.ts')};
                import { SessionClient } from ${source('terminal/session-client.ts')};
                import { sessionSinkFor } from ${source('state/sessions.ts')};
                import { loadEditorEngine } from ${source('shell/panels/editor-engine.ts')};
                import { useFiles } from ${source('state/files.ts')};
                import { useWindow } from ${source('state/window.ts')};
                import { useProject } from ${source('state/project.ts')};
                import { useDocument } from ${source('state/document.ts')};
                import { useEndpoints } from ${source('state/endpoints.ts')};
                import { machineFor } from ${source('transport/connections.ts')};
                import { ConnectionContext } from ${source('transport/context.ts')};
                import { ChatScopeProvider } from ${source('transport/ChatScopeProvider.tsx')};
                import words from ${source('i18n/locales/en/canvas.json')};
                import panels from ${source('i18n/locales/en/panels.json')};
                i18next.addResourceBundle('en','canvas',words,true,true);i18next.addResourceBundle('en','panels',panels,true,true);
                useEndpoints.setState({activeId:'local',endpoints:[{id:'local',label:'Local'},{id:'remote',label:'Shell owner'}]});
                useWindow.getState().show({kind:'workspace',workspace:{connection:{endpointId:'remote'}}});
                useProject.setState({current:{folder:${JSON.stringify(shell.home)},projectId:'fixture'}});
                useDocument.getState().load({version:3,rev:1,name:'Files',color:'#000',views:[{id:'shell',kind:'terminal',name:'Shell',node:{cwd:${JSON.stringify(shell.home)}}}]},null);
                const wire=new WebSocketTransport('ws://127.0.0.1:${server.port}');window.wire=wire;window.fileReads=[];
                const request=wire.request.bind(wire);wire.request=(type,payload)=>{if(type==='fs.read')window.fileReads.push(payload.path);return request(type,payload)};
                await new Promise(resolve=>{const off=wire.subscribeStatus(status=>{if(status==='open'){off();resolve()}})});
                const machine=machineFor('remote');machine.transport=wire;machine.sessions=new SessionClient(wire,sessionSinkFor('remote'));
                window.files=useFiles;window.snapshots=0;window.resyncs=0;wire.on('session.resync',()=>window.resyncs++);
                const write=Terminal.prototype.write;Terminal.prototype.write=function(data,done){window.term=this;return write.call(this,data,()=>{done?.();if(data.includes('ruimte-cwd;'))window.snapshots++})};
                const engine=await loadEditorEngine();const mount=engine.mount.bind(engine);engine.mount=(element,options)=>window.editor=mount(element,options);
                function Preview(){const reveal=useFiles(state=>state.revealLine);return reveal&&<div className="editor"><FileBody key={reveal.key} path={reveal.key} name="same.ts" on="tab" tabKey={reveal.key}/></div>}
                createRoot(document.getElementById('root')).render(<UIProvider i18n={i18next}><ConnectionContext.Provider value={machine}><ChatScopeProvider><div className="pane"><TerminalBody id="shell" focused={false}/></div><Preview/></ChatScopeProvider></ConnectionContext.Provider></UIProvider>);
            `,
                `${css}\n${terminalCss}\n.pane{position:absolute;width:700px;height:260px}.absolute{position:absolute}.bottom-0{bottom:0}.inset-x-0{left:0;right:0}.relative{position:relative}.inset-0{inset:0}.pointer-events-none{pointer-events:none}.flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1}.grow{flex-grow:1}.min-h-0{min-height:0}.h-full{height:100%}.editor{position:absolute;top:300px;width:790px;height:280px}svg{width:14px;height:14px}`,
                async (view) => {
                    await waitBrowser(view, 'window.term?.buffer.active.getLine(0)!==undefined');
                    await waitFor(() => attaches > 0, 'browser attaching');
                    manager.write('shell', "print -r -- 'OLD same.ts:12:4-16'\r", 'person');
                    await waitBrowser(view, hasLine('OLD '));
                    if (mode.startsWith('subshell-')) {
                        manager.write(
                            'shell',
                            "stty tostop; ( cd nested >/dev/null 2>&1; print -r -- 'CHILD same.ts:12:4-16' ); print -r -- 'UNCERTAIN same.ts:12:4-16'\r",
                            'person'
                        );
                        await waitBrowser(view, hasLine('UNCERTAIN '));
                        for (const prefix of ['CHILD ', 'UNCERTAIN ']) {
                            await openLocation(view, prefix, null, mode.endsWith('-menu'), '');
                        }
                        manager.write('shell', "print -r -- 'PARENT same.ts:12:4-16'\r", 'person');
                        await waitBrowser(view, hasLine('PARENT '));
                        await openLocation(view, 'PARENT ', files[0]!, mode.endsWith('-menu'), 'ROOT');
                    }
                    if (mode === 'late-precmd') {
                        await writeFile(join(shell.home, 'change-next'), '');
                        manager.write('shell', 'true\r', 'person');
                        await waitBrowser(view, hasLine('AFTER '));
                        await openLocation(view, 'BEFORE ', files[0]!, false, 'ROOT');
                        await openLocation(view, 'AFTER ', files[1]!, true, 'NESTED');
                    } else {
                        const cd = mode.startsWith('subshell-')
                            ? `cd '${nestedName}' >/dev/null 2>&1`
                            : mode.startsWith('redirected-cd')
                              ? `cd '${nestedName}' >/dev/null${mode.includes('-both-') ? ' 2>&1' : ''}`
                              : mode.startsWith('redirected-block')
                                ? `{ print -r -- BLOCK_OUT; print -ru2 -- BLOCK_ERR; cd '${nestedName}'; } >redirected.out 2>redirected.err`
                                : mode.startsWith('redirected-function')
                                  ? `go_nested() { print -r -- FUNCTION_OUT; print -ru2 -- FUNCTION_ERR; cd '${nestedName}'; }; go_nested >redirected.out 2>redirected.err`
                                  : `cd '${nestedName}'`;
                        manager.write('shell', `${cd}; print -r -- 'NEW same.ts:12:4-16'\r`, 'person');
                        await waitBrowser(view, hasLine('NEW '));
                    }
                    if (mode === 'reconnect') {
                        const before = attaches;
                        const snapshots = await view.evaluate<number>('window.snapshots');
                        await view.evaluate('window.wire.reconnect()');
                        await waitFor(() => attaches > before, 'reattaching socket');
                        await waitBrowser(view, `window.snapshots>${snapshots}`);
                        await waitBrowser(view, hasLine('NEW '));
                    }
                    if (mode === 'restore') {
                        const store = new SnapshotStore(join(shell.home, 'saved'));
                        await store.write('shell', await manager.get('shell')!.serializeScreen());
                        // A daemon that stops cannot deliver a process-exit event to the disconnected client.
                        stopping = true;
                        manager.killAll();
                        await waitFor(() => manager.list().every((session) => session.exited), 'old shell exiting');
                        const restored = new SessionManager({
                            adapter: new BunPtyAdapter(),
                            snapshots: store,
                            shellEnvironment: await prepareShellIntegration(join(shell.home, 'ruimte')),
                            env: { HOME: shell.home, PATH: '/usr/bin:/bin', SHELL: '/bin/zsh' }
                        });
                        restarted.push(restored);
                        manager = restored;
                        stopping = false;
                        register();
                        await manager.create({ sessionId: 'shell', cwd: shell.home, shell: '/bin/zsh', args: ['-i'], cols: 70, rows: 15 });
                        const before = attaches;
                        const snapshots = await view.evaluate<number>('window.snapshots');
                        await view.evaluate('window.wire.reconnect()');
                        await waitFor(() => attaches > before, 'restored attach');
                        await waitBrowser(view, `window.snapshots>${snapshots}`);
                        await waitBrowser(view, hasLine('NEW '));
                    }
                    if (mode.startsWith('redirected-block') || mode.startsWith('redirected-function')) {
                        manager.write(
                            'shell',
                            "cd .. >/dev/null 2>&1; print -r -- 'BACK same.ts:12:4-16'; cd nested >/dev/null; print -r -- 'AGAIN same.ts:12:4-16'\r",
                            'person'
                        );
                        await waitBrowser(view, hasLine('AGAIN '));
                        for (const menu of [mode.endsWith('-menu')]) {
                            await openLocation(view, 'BACK ', files[0]!, menu, 'ROOT');
                            await openLocation(view, 'AGAIN ', files[1]!, menu, 'NESTED');
                        }
                    }
                    const newer = mode === 'late-precmd' ? 'AFTER ' : 'NEW ';
                    for (const menu of mode.startsWith('redirected-') || mode.startsWith('subshell-') ? [mode.endsWith('-menu')] : [false, true]) {
                        await openLocation(view, 'OLD ', files[0]!, menu, 'ROOT');
                        await openLocation(view, newer, files[1]!, menu, 'NESTED');
                    }
                    if (!mode.startsWith('redirected-') && !mode.startsWith('subshell-')) {
                        // A real session resize and scrollback move precede the same interactions.
                        await view.evaluate("window.wire.request('session.resize',{sessionId:'shell',cols:18,rows:12})");
                        manager.write('shell', 'repeat 25 print -r -- filler\r', 'person');
                        await waitBrowser(view, hasLine('filler'));
                        await view.evaluate('window.term.scrollToTop()');
                        await openLocation(view, 'OLD ', files[0]!, true, 'ROOT');
                        await openLocation(view, newer, files[1]!, false, 'NESTED');
                    }
                    if (mode === 'live' || mode === 'strict-zshenv' || mode === 'strict-zshrc') {
                        const snapshots = await view.evaluate<number>('window.snapshots');
                        await view.evaluate("window.wire.request('session.clear',{sessionId:'shell'})");
                        await waitBrowser(view, `window.snapshots>${snapshots}`);
                        expect(await view.evaluate<boolean>(hasLine('OLD '))).toBe(false);
                        manager.write('shell', "print -r -- 'CLEAR same.ts:12:4-16'\r", 'person');
                        await waitBrowser(view, hasLine('CLEAR '));
                        await openLocation(view, 'CLEAR ', files[1]!, false, 'NESTED');
                        await openLocation(view, 'CLEAR ', files[1]!, true, 'NESTED');
                    }
                    if (mode.startsWith('redirected-block') || mode.startsWith('redirected-function')) {
                        const label = mode.startsWith('redirected-block') ? 'BLOCK' : 'FUNCTION';
                        expect(await readFile(join(shell.home, 'redirected.out'), 'utf8')).toBe(`${label}_OUT\n`);
                        expect(await readFile(join(shell.home, 'redirected.err'), 'utf8')).toBe(`${label}_ERR\n`);
                    }
                    if (mode.startsWith('subshell-')) {
                        for (const prefix of ['CHILD ', 'UNCERTAIN ']) {
                            await openLocation(view, prefix, null, mode.endsWith('-menu'), '');
                        }
                    }
                    expect(reads).toContain(files[0]!);
                    expect(reads).toContain(files[1]!);
                    expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
                }
            );
        } finally {
            await server.stop(true);
            restarted.forEach((manager) => manager.killAll());
            if (restarted.length) {
                await waitFor(() => restarted.every((manager) => manager.list().every((session) => session.exited)), 'restored fixture exit');
            }
            await shell.cleanup();
        }
    });
}

function hasLine(prefix: string): string {
    return `Array.from({length:window.term?.buffer.active.length??0},(_,row)=>window.term.buffer.active.getLine(row).translateToString(true)).some(line=>line.startsWith(${JSON.stringify(prefix)}))`;
}

async function waitBrowser(view: View, condition: string): Promise<void> {
    for (let attempt = 0; attempt < 80; attempt++) {
        if (await view.evaluate<boolean>(condition)) {
            return;
        }
        await view.evaluate(frame);
    }
    throw new Error('Browser did not settle: ' + condition + ' ' + (await view.evaluate<string>('JSON.stringify(window.errors)')));
}

async function openLocation(view: View, prefix: string, path: string | null, menu: boolean, content: string): Promise<void> {
    // Unmount the previous preview so neither route can pass with cached content or an old selection.
    await view.evaluate(
        '(()=>{window.files.setState({tabs:[],focusRequest:null,revealLine:null});window.fileReads=[];window.editor=null;window.term.clearSelection()})()'
    );
    await view.evaluate(frame);
    const point = await view.evaluate<{ x: number; y: number }>(`(()=>{
        const term=window.term,buffer=term.buffer.active;let row=0;
        while(row<buffer.length&&!buffer.getLine(row).translateToString(true).startsWith(${JSON.stringify(prefix)}))row++;
        if(row===buffer.length)throw new Error('Missing output '+${JSON.stringify(prefix)});
        const character=${prefix.length}+2;row+=Math.floor(character/term.cols);const column=character%term.cols;
        term.scrollToLine(row);const rect=term.element.querySelector('.xterm-screen').getBoundingClientRect();
        return {x:rect.x+(column+0.5)*rect.width/term.cols,y:rect.y+(row-buffer.viewportY+0.5)*rect.height/term.rows};
    })()`);
    await view.evaluate(frame);
    const anotherRow = await view.evaluate<{ x: number; y: number }>(
        `(()=>{const rect=window.term.element.querySelector('.xterm-screen').getBoundingClientRect();const targetRow=Math.floor((${point.y}-rect.y)*window.term.rows/rect.height);return {x:rect.x+2.5*rect.width/window.term.cols,y:rect.y+(targetRow===1?0.5:1.5)*rect.height/window.term.rows}})()`
    );
    await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...anotherRow });
    await view.evaluate(frame);
    await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 790, y: 290 });
    await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x - 9, y: point.y });
    await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await view.evaluate(frame);
    const click = async (location: { x: number; y: number }, button: 'left' | 'right', modifiers: number): Promise<void> => {
        await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...location, button, buttons: button === 'left' ? 1 : 2, clickCount: 1, modifiers });
        await view.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...location, button, buttons: 0, clickCount: 1, modifiers });
        await view.evaluate(frame);
    };
    await click(point, menu ? 'right' : 'left', menu ? 0 : process.platform === 'darwin' ? 4 : 2);
    if (path === null) {
        expect(await view.evaluate<unknown>('window.files.getState().tabs')).toEqual([]);
        expect(await view.evaluate<unknown>('window.fileReads')).toEqual([]);
        expect(await view.evaluate<unknown>('window.files.getState().revealLine')).toBeNull();
        if (menu) {
            expect(
                await view.evaluate<boolean>(`[...document.querySelectorAll('[role=menuitem]')].some(item=>item.textContent.includes('Open file in preview'))`)
            ).toBe(false);
            await view.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
            await view.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
            await view.evaluate(frame);
        }
        return;
    }
    if (menu) {
        const menuPoint = await view.evaluate<{ x: number; y: number }>(
            `(()=>{const item=[...document.querySelectorAll('[role=menuitem]')].find(item=>item.textContent.includes('Open file in preview'));if(!item)throw new Error('No preview item');const rect=item.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}})()`
        );
        await click(menuPoint, 'left', 0);
    }
    await waitBrowser(view, 'window.editor?.getText().includes(" line 30")??false');
    expect(
        await view.evaluate<unknown>(`(()=>{
        const {nonce,...location}=window.files.getState().revealLine;
        return {location,reads:window.fileReads.filter(path=>!path.endsWith('/.editorconfig')),text:window.editor.getText(),selection:window.editor.getSelection()};
    })()`)
    ).toEqual({
        location: { key: path, line: 12, column: 4, endLine: 16 },
        reads: [path],
        text: Array.from({ length: 30 }, (_, line) => `${content} line ${line + 1}`).join('\n'),
        selection: { start: { line: 11, character: 3 }, end: { line: 15, character: `${content} line 16`.length } }
    });
}
