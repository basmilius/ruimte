import { expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PROTOCOL_VERSION } from '@ruimte/contracts';
import { join } from 'node:path';
import { clientDirectory, withBrowserFixture } from '../../testing/browser-fixture';

type View = InstanceType<typeof Bun.WebView>;
const frame = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))';
const relative = 'src/例 folder with spaces/a sufficiently long file name.ts';
const reference = `"${relative}:12:4-16"`;
const path = `/repo/worktree/${relative}`;
const output = `${reference}\r\nmissing.ts:3\r\ninvalid.ts:0-2\r\nhttps://ruimte.app/docs\r\n`;

async function fixture(
    onCanvas: boolean,
    run: (view: View) => Promise<void>,
    suppliedOutput?: string,
    options: { platform?: 'darwin' | 'linux'; language?: 'en' | 'nl' } = {}
): Promise<void> {
    const terminalOutput =
        suppliedOutput ?? '\x1b]7;file://fixture/repo/worktree\x07' + (onCanvas ? output.replaceAll(reference, reference.slice(1, -1)) : output);
    const terminalPackage = await realpath(join(clientDirectory, 'node_modules/@adecore/terminal'));
    const css = await readFile(join(clientDirectory, 'node_modules/@xterm/xterm/css/xterm.css'), 'utf8');
    const terminalCss = await readFile(join(terminalPackage, 'src/terminal.css'), 'utf8');
    const backend = await fileServer();
    try {
        await withBrowserFixture(
            `
        import { Terminal } from ${JSON.stringify(Bun.resolveSync('@xterm/xterm', terminalPackage))};
        import { TerminalBody } from ${JSON.stringify(join(import.meta.dir, '../nodes/TerminalBody.tsx'))};
        import { FileBody } from ${JSON.stringify(join(import.meta.dir, '../shell/panels/FileBody.tsx'))};
        import { WebSocketTransport } from ${JSON.stringify(join(import.meta.dir, '../transport/websocket-transport.ts'))};
        import { loadEditorEngine } from ${JSON.stringify(join(import.meta.dir, '../shell/panels/editor-engine.ts'))};
        import { useFiles } from ${JSON.stringify(join(import.meta.dir, '../state/files.ts'))};
        import { useWindow } from ${JSON.stringify(join(import.meta.dir, '../state/window.ts'))};
        import { useProject } from ${JSON.stringify(join(import.meta.dir, '../state/project.ts'))};
        import { useDocument } from ${JSON.stringify(join(import.meta.dir, '../state/document.ts'))};
        import { defaultCanvasStore } from ${JSON.stringify(join(import.meta.dir, '../state/canvas.ts'))};
        import { useToasts } from ${JSON.stringify(join(import.meta.dir, '../state/toasts.ts'))};
        import { ChatScopeProvider } from ${JSON.stringify(join(import.meta.dir, '../transport/ChatScopeProvider.tsx'))};
        import { transport } from ${JSON.stringify(join(import.meta.dir, '../transport/index.ts'))};
        import { ConnectionContext } from ${JSON.stringify(join(import.meta.dir, '../transport/context.ts'))};
        import { machineFor } from ${JSON.stringify(join(import.meta.dir, '../transport/connections.ts'))};
        import { useEndpoints } from ${JSON.stringify(join(import.meta.dir, '../state/endpoints.ts'))};
        import words from ${JSON.stringify(join(import.meta.dir, '../i18n/locales/en/canvas.json'))};
        import dutchWords from ${JSON.stringify(join(import.meta.dir, '../i18n/locales/nl/canvas.json'))};
        import panelWords from ${JSON.stringify(join(import.meta.dir, '../i18n/locales/en/panels.json'))};
        i18next.addResourceBundle('en', 'canvas', words, true, true);
        i18next.addResourceBundle('en', 'panels', panelWords, true, true);
        i18next.addResourceBundle('nl', 'canvas', dutchWords, true, true);
        await i18next.changeLanguage(${JSON.stringify(options.language ?? 'en')});
        window.instances={}; window.outputs={}; window.screens={}; window.sizes={}; window.opened=[]; window.reads=[]; window.attaches=[]; window.files=useFiles; window.toasts=useToasts;
        window.ruimteDesktop={platform:${JSON.stringify(options.platform ?? process.platform)},openExternal:async uri=>window.opened.push(uri)};
        useEndpoints.setState({activeId:'elsewhere',endpoints:[{id:'local',label:'Local'},{id:'remote',label:'Remote'}]});
        useProject.setState({current:{folder:'/repo',projectId:'fixture'}});
        const views=['local','remote'].map(id=>({id,kind:'terminal',name:id,node:{cwd:'/repo/worktree'}}));
        useDocument.getState().load({version:3,rev:1,name:'Files',color:'#000',views},null);
        if (${onCanvas}) {
            defaultCanvasStore.setState({viewId:'canvas',nodes:Object.fromEntries(views.map(view=>[view.id,{id:view.id,kind:'terminal',title:view.name,cwd:'/repo/worktree',x:0,y:0,w:360,h:250}]))});
        }
        window.switchMachine = endpointId => {
            useWindow.getState().show({kind:'workspace',workspace:{connection:{endpointId}}});
            useFiles.setState({projectId:null,tabs:[],focusRequest:null,revealLine:null});
        };
        window.switchMachine('local');
        Object.defineProperty(transport,'status',{get:()=> 'open'});
        let ready; window.ready=new Promise(resolve=>ready=resolve); let count=0;
        const write=Terminal.prototype.write;
        Terminal.prototype.write=function(data,done){
            return write.call(this,data,()=>{done?.();window.written?.();window.written=null;if(data===${JSON.stringify(terminalOutput)}){
                window.instances[this.element.closest('[data-owner]').dataset.owner]=this;
                if(++count===2) ready();
            }});
        };
        const machines=await Promise.all(['local','remote'].map(async endpointId=>{
            const wire=new WebSocketTransport(${JSON.stringify(backend.url)}+'/'+endpointId);
            await new Promise(resolve=>{if(wire.status==='open')resolve();else {const off=wire.subscribeStatus(status=>{if(status==='open'){off();resolve()}})}});
            const machine=machineFor(endpointId);
            machine.sessions.open=async(id,options,cols,rows)=>{window.attaches.push([endpointId,options.cwd]);return {cols,rows,screen:${JSON.stringify(terminalOutput)}}};
            machine.sessions.onOutput=(id,handler)=>{window.outputs[endpointId]=handler;return ()=>{}};
            machine.sessions.onSize=(id,handler)=>{window.sizes[endpointId]=handler;return ()=>{}};
            machine.sessions.onScreen=(id,handler)=>{window.screens[endpointId]=handler;return ()=>{}};
            machine.sessions.write=()=>{}; machine.sessions.resize=()=>{}; machine.sessions.detach=async()=>{};
            machine.transport.request=async(type,payload)=>{
                if(type==='fs.read'){
                    window.reads.push([endpointId,payload.path]);
                    return wire.request(type,payload);
                }
                if(type==='git.worktree-list') return {worktrees:[]};
                return {};
            };
            Object.defineProperty(machine.transport,'status',{get:()=> 'open'});
            return machine;
        }));
        window.writeOutput=(endpointId,data)=>new Promise(resolve=>{window.written=resolve;window.outputs[endpointId](data)});
        window.replaceScreen=(endpointId,screen)=>new Promise(resolve=>{window.written=resolve;window.screens[endpointId]({screen})});
        const engine=await loadEditorEngine(); const mount=engine.mount.bind(engine);
        engine.mount=(element,options)=>{const editor=mount(element,options);window.editor=editor;return editor};
        function Preview(){
            const reveal=useFiles(state=>state.revealLine);
            const owner=useWindow(state=>state.content.workspace?.connection.endpointId);
            const machine=machines.find(machine=>machine.endpointId===owner);
            return reveal && machine && <div className="editor"><ConnectionContext.Provider value={machine}><ChatScopeProvider>
                <FileBody key={owner+reveal.key} path={reveal.key} name={reveal.key.split('/').at(-1)} on="tab" tabKey={reveal.key}/>
            </ChatScopeProvider></ConnectionContext.Provider></div>;
        }
        window.root=createRoot(document.getElementById('root'));
        function Fixture(){const [source, setSource]=React.useState(null);window.switchSource=()=>setSource('remote');return <UIProvider i18n={i18next}>
            {machines.map((machine,index)=><div key={machine.endpointId} data-owner={machine.endpointId} className="pane" style={{left:index*400}}>
                <ConnectionContext.Provider value={machine}><ChatScopeProvider><TerminalBody id={source??machine.endpointId} focused={false}/></ChatScopeProvider></ConnectionContext.Provider>
            </div>)}<Preview/>
        </UIProvider>;}
        window.root.render(<Fixture/>);
    `,
            `${css}\n${terminalCss}\n.pane{position:absolute;width:360px;height:250px;top:0}.pointer-events-none{pointer-events:none}.absolute{position:absolute}.relative{position:relative}.inset-0{inset:0}.flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1}.grow{flex-grow:1}.min-h-0{min-height:0}.h-full{height:100%}.editor{position:absolute;top:310px;left:0;width:790px;height:270px}.editor>div{height:100%}svg{width:14px;height:14px}.tooltip-popup{max-width:288px;overflow-wrap:anywhere}`,
            async (view) => {
                await view.evaluate('window.ready');
                await view.evaluate(frame);
                await run(view);
                expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
            }
        );
    } finally {
        await backend.close();
    }
}

async function pointAt(view: View, owner: string, row: number, column = 2): Promise<{ x: number; y: number }> {
    return view.evaluate(`(() => {
        const term=window.instances[${JSON.stringify(owner)}]; const rect=term.element.querySelector('.xterm-screen').getBoundingClientRect();
        return {x:rect.x+((${column}+0.5)*rect.width/term.cols),y:rect.y+((${row}+0.5)*rect.height/term.rows)};
    })()`);
}

for (const [platform, language, zoom] of [
    ['darwin', 'en', 1],
    ['linux', 'nl', 0.65]
] as const) {
    test(`file tooltip follows wrapped hover, scope and cleanup: ${platform}/${language}/${zoom}`, async () => {
        await fixture(
            zoom !== 1,
            async (view) => {
                await view.evaluate(
                    `document.querySelector('[data-owner=local]').style.cssText='left:100px;top:160px;transform-origin:top left;transform:scale(${zoom})'`
                );
                await view.evaluate(frame);
                const text = zoom === 1 ? reference : reference.slice(1, -1);
                const words = language === 'en' ? '⌘+click to open file in preview' : 'Ctrl+klik om bestand in preview te openen';
                await hover(view, 'local', 0);
                await tooltipSettled(view);
                expect(await view.evaluate<string>(`document.querySelector('[role=tooltip]').textContent`)).toBe(words + text);
                expect(await view.evaluate<number>(`document.querySelectorAll('[role=tooltip]').length`)).toBe(1);
                expect(await view.evaluate<string>(`getComputedStyle(document.querySelector('.tooltip-positioner')).pointerEvents`)).toBe('none');
                const rows = await view.evaluate<number>(`Math.ceil((${text.length}+1)/window.instances.local.cols)`);
                expect(rows).toBeGreaterThan(1);
                // Stay inside the same link while moving onto its next wrapped segment.
                for (let row = 0; row < rows; row++) {
                    await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...(await pointAt(view, 'local', row)) });
                    await tooltipSettled(view);
                    const geometry = await view.evaluate<{
                        center: number;
                        expectedCenter: number;
                        top: number;
                        bottom: number;
                        linkTop: number;
                        linkBottom: number;
                    }>(`(()=>{
                    const term=window.instances.local,screen=term.element.querySelector('.xterm-screen').getBoundingClientRect();
                    const box=document.querySelector('.tooltip-positioner').getBoundingClientRect();
                    const cells=${row}===${rows}-1?(${text.length}+1)%term.cols||term.cols:term.cols;
                    const linkTop=screen.top+${row}*screen.height/term.rows;
                    return {center:box.x+box.width/2,expectedCenter:screen.x+cells*screen.width/term.cols/2,top:box.top,bottom:box.bottom,linkTop,linkBottom:linkTop+screen.height/term.rows};
                })()`);
                    expect(geometry.center).toBeCloseTo(geometry.expectedCenter, 0);
                    expect(geometry.bottom <= geometry.linkTop || geometry.top >= geometry.linkBottom).toBe(true);
                    expect(await view.evaluate<string>(`document.querySelector('[role=tooltip]').textContent`)).toBe(words + text);
                }
                await hover(view, 'local', rows + 2);
                await tooltipSettled(view);
                expect(await view.evaluate<string>(`document.querySelector('[role=tooltip]').textContent`)).toContain('https://ruimte.app/docs');
                expect(await view.evaluate<string>(`document.querySelector('[role=tooltip]').textContent`)).not.toContain(text);
                expect(await view.evaluate<number>(`document.querySelectorAll('[role=tooltip]').length`)).toBe(1);
                await hover(view, 'local', 0);
                await tooltipSettled(view);
                await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 790, y: 590 });
                await expectNoTooltip(view);
                await hover(view, 'local', 0);
                await view.evaluate(`window.writeOutput('local',${JSON.stringify('\x1b[2J\x1b[Hremoved\r\n')})`);
                await expectNoTooltip(view);
                await view.evaluate(
                    `window.replaceScreen('local',${JSON.stringify('\x1b]7;file://fixture/repo/worktree\x07' + text + '\r\n' + 'filler\r\n'.repeat(40))})`
                );
                await view.evaluate('window.instances.local.scrollToTop()');
                await hover(view, 'local', 0);
                await tooltipSettled(view);
                await view.evaluate('window.instances.local.scrollLines(1)');
                await expectNoTooltip(view);
                await view.evaluate('window.instances.local.scrollToTop()');
                await hover(view, 'local', 0);
                await tooltipSettled(view);
                await view.evaluate('window.switchSource()');
                await expectNoTooltip(view);
                await hover(view, 'local', 0);
                await tooltipSettled(view);
                await view.evaluate('window.root.unmount()');
                await expectNoTooltip(view);
            },
            undefined,
            { platform, language }
        );
    });
}

async function tooltipSettled(view: View): Promise<void> {
    await view.evaluate(frame);
    await view.evaluate(
        `Promise.all([...document.querySelectorAll('.tooltip-positioner,.tooltip-popup')].flatMap(element=>element.getAnimations()).map(animation=>animation.finished.catch(()=>undefined)))`
    );
}

async function expectNoTooltip(view: View): Promise<void> {
    await tooltipSettled(view);
    await view.evaluate(frame);
    expect(await view.evaluate<number>(`document.querySelectorAll('[role=tooltip],.tooltip-positioner').length`)).toBe(0);
}

async function hover(view: View, owner: string, row: number): Promise<{ x: number; y: number }> {
    await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 790, y: 290 });
    const point = await pointAt(view, owner, row);
    await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x - 9, y: point.y });
    await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await view.evaluate(frame);
    return point;
}

async function click(view: View, point: { x: number; y: number }, button: 'left' | 'right' = 'left', modifiers = 0): Promise<void> {
    await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button, buttons: button === 'left' ? 1 : 2, clickCount: 1, modifiers });
    await view.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button, buttons: 0, clickCount: 1, modifiers });
    await view.evaluate(frame);
}

async function menuOpen(view: View): Promise<void> {
    const point = await view.evaluate<{ x: number; y: number }>(`(() => {
        const item=[...document.querySelectorAll('[role=menuitem]')].find(element=>element.textContent.includes('Open file in preview'));
        if(!item) throw new Error('No file preview menu item');
        const rect=item.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
    })()`);
    await click(view, point);
}

for (const onCanvas of [false, true]) {
    test(`wrapped file links preserve cwd, column, range and owner in a terminal ${onCanvas ? 'node' : 'view'}`, async () => {
        await fixture(onCanvas, async (view) => {
            const modifier = process.platform === 'darwin' ? 4 : 2;
            const rows = await view.evaluate<number>(`Math.ceil(${reference.length}/window.instances.local.cols)`);
            expect(rows).toBeGreaterThan(1);
            expect(await view.evaluate<unknown>('window.attaches')).toEqual([
                ['local', '/repo/worktree'],
                ['remote', '/repo/worktree']
            ]);
            for (let row = 0; row < rows; row++) {
                await click(view, await hover(view, 'local', row));
                if (row === 0) {
                    expect(await view.evaluate<unknown>('window.files.getState().tabs')).toEqual([]);
                }
                await click(view, await hover(view, 'local', row), 'left', modifier);
                expect(await view.evaluate<unknown>('window.files.getState().revealLine')).toMatchObject({ key: path, line: 12, column: 4, endLine: 16 });
                await waitForEditor(view, path);
                expect(await view.evaluate<unknown>('window.editor.getSelection()')).toEqual({
                    start: { line: 11, character: 3 },
                    end: { line: 15, character: `local ${path} line 16`.length }
                });
                expect(await view.evaluate<string>('window.editor.getText()')).toContain(`local ${path} line 12`);
                const nonce = await view.evaluate<number>('window.files.getState().revealLine.nonce');
                await click(view, await hover(view, 'local', row), 'right');
                await menuOpen(view);
                expect(await view.evaluate<unknown>('window.files.getState().revealLine')).toEqual({
                    key: path,
                    line: 12,
                    column: 4,
                    endLine: 16,
                    nonce: nonce + 1
                });
            }
            const nonce = await view.evaluate<number>('window.files.getState().revealLine.nonce');
            const from = await hover(view, 'local', 0);
            const to = await pointAt(view, 'local', 0, 18);
            for (const modifiers of [0, modifier]) {
                await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: 1, modifiers });
                await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...to, button: 'left', buttons: 1, modifiers });
                await view.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button: 'left', buttons: 0, clickCount: 1, modifiers });
                await view.evaluate(frame);
                expect(await view.evaluate<unknown>('window.files.getState().revealLine.nonce')).toBe(nonce);
                await view.evaluate('window.instances.local.clearSelection()');
                await hover(view, 'local', 0);
            }
            await click(view, await hover(view, 'remote', 0), 'left', modifier);
            expect(await view.evaluate<unknown>('window.files.getState().revealLine.nonce')).toBe(nonce);
            expect(await view.evaluate<string>('window.toasts.getState().toasts.at(-1).title')).toContain('machine that owns it');
            await click(view, await hover(view, 'local', 0), 'right');
            await view.evaluate("window.switchMachine('remote')");
            await menuOpen(view);
            expect(await view.evaluate<unknown>('window.files.getState().tabs')).toEqual([]);
            await click(view, await hover(view, 'remote', rows - 1), 'left', modifier);
            expect(await view.evaluate<unknown>('window.files.getState().revealLine')).toMatchObject({ key: path, line: 12, column: 4, endLine: 16 });
            await waitForEditor(view, path, 'remote');
            expect(await view.evaluate<string>('window.editor.getText()')).toBe(
                Array.from({ length: 30 }, (_, index) => `remote ${path} line ${index + 1}`).join('\n')
            );
            await click(view, await hover(view, 'remote', rows), 'left', modifier);
            expect(await view.evaluate<unknown>('window.files.getState().revealLine')).toMatchObject({ key: '/repo/worktree/missing.ts', line: 3 });
            expect(await view.evaluate<unknown>('window.reads.filter(([,path])=>!path.endsWith("/.editorconfig"))')).toEqual([
                ['local', path],
                ['remote', path],
                ['remote', '/repo/worktree/missing.ts']
            ]);
            expect(await view.evaluate<string>('document.querySelector(".editor").textContent')).toContain('File not found on remote');
            const missingNonce = await view.evaluate<number>('window.files.getState().revealLine.nonce');
            await click(view, await hover(view, 'remote', rows + 1), 'left', modifier);
            expect(await view.evaluate<unknown>('window.files.getState().revealLine.nonce')).toBe(missingNonce);
            await click(view, await hover(view, 'remote', rows + 2), 'left', modifier);
            expect(await view.evaluate<unknown>('window.opened')).toEqual(['https://ruimte.app/docs']);
        });
    });
}

const modifier = process.platform === 'darwin' ? 4 : 2;

async function expectLocation(view: View, path: string): Promise<void> {
    expect(await view.evaluate<unknown>('window.files.getState().revealLine')).toMatchObject({ key: path, line: 12, column: 4, endLine: 16 });
    await waitForEditor(view, path);
    expect(await view.evaluate<string>('window.editor.getText()')).toContain(`local ${path} line 12`);
}

test('output cwd follows cd, survives buffer reflow, and old output keeps its own cwd', async () => {
    await fixture(
        false,
        async (view) => {
            await click(view, await hover(view, 'local', 0), 'left', modifier);
            await expectLocation(view, '/repo/worktree/same.ts');
            await view.evaluate(`window.writeOutput('local', '\\x1b]7;file://fixture/repo/worktree/nested\\x07same.ts:12:4-16\\r\\n')`);
            await click(view, await hover(view, 'local', 1), 'left', modifier);
            await expectLocation(view, '/repo/worktree/nested/same.ts');
            await view.evaluate('window.sizes.local({cols:10,rows:12})');
            await view.evaluate(`window.writeOutput('local', '\\r\\n'.repeat(16))`);
            await view.evaluate('window.instances.local.scrollToTop()');
            await view.evaluate(frame);
            for (const [row, path] of [
                [0, '/repo/worktree/same.ts'],
                [2, '/repo/worktree/nested/same.ts']
            ] as const) {
                await click(view, await hover(view, 'local', row), 'left', modifier);
                await expectLocation(view, path);
                await click(view, await hover(view, 'local', row), 'right');
                await menuOpen(view);
                await expectLocation(view, path);
            }
        },
        '\x1b]7;file://fixture/repo/worktree\x07same.ts:12:4-16\r\n'
    );
});

test('relative links without output cwd, including a replaced screen, never use the launch directory', async () => {
    await fixture(
        false,
        async (view) => {
            await click(view, await hover(view, 'local', 0), 'left', modifier);
            expect(await view.evaluate<unknown>('window.files.getState().tabs')).toEqual([]);
            await click(view, await hover(view, 'local', 0), 'right');
            expect(
                await view.evaluate<boolean>(
                    `[...document.querySelectorAll('[role=menuitem]')].some(element=>element.textContent.includes('Open file in preview'))`
                )
            ).toBe(false);
            await view.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
            await view.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
            await view.evaluate(`window.writeOutput('local', '\\x1b]7;file://fixture/repo/nested\\x07same.ts:12:4-16\\r\\n')`);
            await click(view, await hover(view, 'local', 1), 'left', modifier);
            await expectLocation(view, '/repo/nested/same.ts');
            await view.evaluate(`window.replaceScreen('local', 'same.ts:12:4-16\\r\\n/absolute.ts:12:4-16\\r\\n')`);
            const nonce = await view.evaluate<number>('window.files.getState().revealLine.nonce');
            await click(view, await hover(view, 'local', 0), 'left', modifier);
            expect(await view.evaluate<number>('window.files.getState().revealLine.nonce')).toBe(nonce);
            await click(view, await hover(view, 'local', 1), 'left', modifier);
            await expectLocation(view, '/absolute.ts');
        },
        'same.ts:12:4-16\r\n'
    );
});

test('ten-column wide-character wrap padding is omitted but real path spaces survive click and menu', async () => {
    await fixture(
        false,
        async (view) => {
            await view.evaluate('window.sizes.local({cols:10,rows:14})');
            await view.evaluate(
                `window.writeOutput('local', '\\x1b]7;file://fixture/repo/worktree\\x07"src/abcd例.ts:12:4-16"\\r\\n"src/abc 例.ts:12:4-16"\\r\\n')`
            );
            for (const [row, path] of [
                [0, '/repo/worktree/src/abcd例.ts'],
                [3, '/repo/worktree/src/abc 例.ts']
            ] as const) {
                await click(view, await hover(view, 'local', row), 'left', modifier);
                await expectLocation(view, path);
                await click(view, await hover(view, 'local', row + 1), 'right');
                await menuOpen(view);
                await expectLocation(view, path);
            }
        },
        ''
    );
});

async function escapeMenu(view: View): Promise<void> {
    await view.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await view.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await view.evaluate(frame);
}

async function expectCorrectPreviewOrRefusal(view: View, row: number, route: 'click' | 'menu', expectedPath: string): Promise<'opened' | 'refused'> {
    await view.evaluate('(() => {window.files.setState({tabs:[],focusRequest:null,revealLine:null});window.reads=[];window.editor=null})()');
    await view.evaluate('window.instances.local.clearSelection()');
    await view.evaluate(frame);
    // Moving to another row makes xterm query the provider again after a cached row was replaced.
    await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...(await pointAt(view, 'local', row === 0 ? 1 : 0)) });
    await view.evaluate(frame);
    const point = await hover(view, 'local', row);
    if (route === 'click') {
        await click(view, point, 'left', modifier);
    } else {
        await click(view, point, 'right');
        const available = await view.evaluate<boolean>(
            `[...document.querySelectorAll('[role=menuitem]')].some(element=>element.textContent.includes('Open file in preview'))`
        );
        if (available) {
            await menuOpen(view);
        } else {
            await escapeMenu(view);
        }
    }
    const location = await view.evaluate<{ key: string; line: number; column: number; endLine: number } | null>('window.files.getState().revealLine');
    if (location === null) {
        // Refusal is valid only without filesystem access; the controls below still require usable links.
        expect(await view.evaluate<unknown>('window.files.getState().tabs')).toEqual([]);
        expect(await view.evaluate<unknown>('window.reads')).toEqual([]);
        return 'refused';
    }
    await waitForEditor(view, location.key);
    expect(await view.evaluate<string>('window.editor.getText()')).toBe(
        Array.from({ length: 30 }, (_, index) => `local ${expectedPath} line ${index + 1}`).join('\n')
    );
    expect(location).toMatchObject({ key: expectedPath, line: 12, column: 4, endLine: 16 });
    expect(await view.evaluate<unknown>('window.reads.filter(([,path])=>!path.endsWith("/.editorconfig"))')).toEqual([['local', expectedPath]]);
    expect(await view.evaluate<unknown>('window.editor.getSelection()')).toEqual({
        start: { line: 11, character: 3 },
        end: { line: 15, character: `local ${expectedPath} line 16`.length }
    });
    return 'opened';
}

async function expectKnownAndAbsoluteControls(view: View, cwd: string, file: string): Promise<void> {
    await view.evaluate('window.sizes.local({cols:80,rows:14})');
    await view.evaluate(`window.replaceScreen('local', ${JSON.stringify(`\x1b]7;file://fixture${cwd}\x07${file}:12:4-16\r\n/absolute.ts:12:4-16\r\n`)})`);
    expect(await expectCorrectPreviewOrRefusal(view, 0, 'click', `${cwd}/${file}`)).toBe('opened');
    expect(await expectCorrectPreviewOrRefusal(view, 0, 'menu', `${cwd}/${file}`)).toBe('opened');
    expect(await expectCorrectPreviewOrRefusal(view, 1, 'click', '/absolute.ts')).toBe('opened');
    expect(await expectCorrectPreviewOrRefusal(view, 1, 'menu', '/absolute.ts')).toBe('opened');
}

for (const ending of ['', '\r\n']) {
    test(`cursor rewrite after cwd change ${ending === '' ? 'without LF' : 'with LF'} opens its new file or refuses ambiguity`, async () => {
        await fixture(
            false,
            async (view) => {
                await expectKnownAndAbsoluteControls(view, '/repo/worktree/nested', 'same.ts');
                await view.evaluate(`window.replaceScreen('local', '')`);
                const rewritten =
                    '\x1b]7;file://fixture/repo/worktree\x07same.ts:12:4-16\r\n' +
                    '\x1b]7;file://fixture/repo/worktree/nested\x07same.ts:12:4-16\r\n' +
                    '\x1b[2A\r\x1b[2Ksame.ts:12:4-16' +
                    ending;
                await view.evaluate(`window.writeOutput('local', ${JSON.stringify(rewritten)})`);
                const clicked = await expectCorrectPreviewOrRefusal(view, 0, 'click', '/repo/worktree/nested/same.ts');
                expect(await expectCorrectPreviewOrRefusal(view, 0, 'menu', '/repo/worktree/nested/same.ts')).toBe(clicked);
                await expectKnownAndAbsoluteControls(view, '/repo/worktree/nested', 'same.ts');
            },
            ''
        );
    });
}

test('cwd changes within a wrapped logical row open the new file or refuse ambiguity', async () => {
    await fixture(
        false,
        async (view) => {
            await expectKnownAndAbsoluteControls(view, '/repo/b', 'new.ts');
            await view.evaluate('window.sizes.local({cols:10,rows:14})');
            await view.evaluate(`window.replaceScreen('local', '')`);
            const mixed = '\x1b]7;file://fixture/repo/a\x07prefixprefixprefix ' + '\x1b]7;file://fixture/repo/b\x07new.ts:12:4-16\r\n';
            await view.evaluate(`window.writeOutput('local', ${JSON.stringify(mixed)})`);
            expect(await view.evaluate<boolean>('window.instances.local.buffer.active.getLine(1).isWrapped')).toBe(true);
            const clicked = await expectCorrectPreviewOrRefusal(view, 2, 'click', '/repo/b/new.ts');
            expect(await expectCorrectPreviewOrRefusal(view, 2, 'menu', '/repo/b/new.ts')).toBe(clicked);
            await expectKnownAndAbsoluteControls(view, '/repo/b', 'new.ts');
        },
        ''
    );
});

test('missing output metadata refuses both preview routes without filesystem reads', async () => {
    await fixture(
        false,
        async (view) => {
            await expectKnownAndAbsoluteControls(view, '/repo/worktree/nested', 'same.ts');
            await view.evaluate(`window.replaceScreen('local', 'same.ts:12:4-16\\r\\n')`);
            expect(await expectCorrectPreviewOrRefusal(view, 0, 'click', '/repo/worktree/nested/same.ts')).toBe('refused');
            expect(await expectCorrectPreviewOrRefusal(view, 0, 'menu', '/repo/worktree/nested/same.ts')).toBe('refused');
            await expectKnownAndAbsoluteControls(view, '/repo/worktree/nested', 'same.ts');
        },
        ''
    );
});

async function waitForEditor(view: View, path: string, owner = 'local'): Promise<void> {
    for (let attempt = 0; attempt < 60; attempt++) {
        if (await view.evaluate<boolean>(`window.editor?.getText().includes(${JSON.stringify(owner + ' ' + path)}) ?? false`)) {
            return;
        }
        await view.evaluate(frame);
    }
    throw new Error(`Preview did not load ${owner}:${path}: ${await view.evaluate<string>('JSON.stringify({errors:window.errors,reads:window.reads})')}`);
}

async function fileServer(): Promise<{ url: string; close(): Promise<void> }> {
    const directory = await mkdtemp(join(tmpdir(), 'ruimte-file-machines-'));
    const files = new Map<string, string>();
    for (const owner of ['local', 'remote']) {
        for (const location of [
            path,
            '/repo/worktree/same.ts',
            '/repo/worktree/nested/same.ts',
            '/repo/nested/same.ts',
            '/repo/a/new.ts',
            '/repo/b/new.ts',
            '/absolute.ts',
            '/repo/worktree/src/abcd例.ts',
            '/repo/worktree/src/abc 例.ts'
        ]) {
            const file = join(directory, String(files.size));
            await writeFile(file, Array.from({ length: 30 }, (_, index) => `${owner} ${location} line ${index + 1}`).join('\n'));
            files.set(`${owner}:${location}`, file);
        }
    }
    const server = Bun.serve<{ owner: string }>({
        hostname: '127.0.0.1',
        port: 0,
        fetch(request, server) {
            const owner = new URL(request.url).pathname.slice(1);
            return server.upgrade(request, { data: { owner } }) ? undefined : new Response('WebSocket required', { status: 400 });
        },
        websocket: {
            async message(socket, message) {
                const request = JSON.parse(String(message)) as { id: string; type: string; payload: { path?: string } };
                if (request.type === 'endpoint.info') {
                    socket.send(JSON.stringify({ id: request.id, ok: true, result: { protocol: PROTOCOL_VERSION } }));
                    return;
                }
                const file = files.get(`${socket.data.owner}:${request.payload.path}`);
                if (request.type !== 'fs.read' || file === undefined) {
                    socket.send(JSON.stringify({ id: request.id, ok: false, error: { code: 'not-found', message: 'File not found on ' + socket.data.owner } }));
                    return;
                }
                const text = await readFile(file, 'utf8');
                socket.send(
                    JSON.stringify({ id: request.id, ok: true, result: { kind: 'text', text, size: Buffer.byteLength(text), mtime: 1, encoding: 'utf-8' } })
                );
            }
        }
    });
    return {
        url: `ws://127.0.0.1:${server.port}`,
        async close() {
            await server.stop(true);
            await rm(directory, { recursive: true, force: true });
        }
    };
}

for (const [name, output, row] of [
    [
        'cursor rewrite',
        '\x1b]7;file://fixture/repo/worktree\x07same.ts:12:4-16\r\n\x1b]7;file://fixture/repo/worktree/nested\x07second row\r\n\x1b[2A\x1b[2Ksame.ts:12:4-16',
        0
    ],
    ['malformed cwd', '\x1b]7;file://fixture/repo/worktree\x07old\r\n\x1b]7;file://fixture/%00\x07same.ts:12:4-16', 1],
    ['alternate screen', '\x1b]7;file://fixture/repo/worktree\x07\x1b[?1049hsame.ts:12:4-16', 0],
    ['screen erase', '\x1b]7;file://fixture/repo/worktree\x07old\r\n\x1b[2Jsame.ts:12:4-16', 1],
    ['terminal reset', '\x1b]7;file://fixture/repo/worktree\x07old\r\n\x1bcsame.ts:12:4-16', 0]
] as const) {
    test(`${name} refuses ambiguous relative links through click and menu, and absolute preview still reads its file`, async () => {
        await fixture(
            false,
            async (view) => {
                await assertRefused(view, row);
                await view.evaluate(`window.writeOutput('local', '\\r\\n/absolute.ts:12:4-16\\r\\n')`);
                await click(view, await hover(view, 'local', row + 1), 'left', modifier);
                await expectLocation(view, '/absolute.ts');
                await click(view, await hover(view, 'local', row + 1), 'right');
                await menuOpen(view);
                await expectLocation(view, '/absolute.ts');
            },
            output
        );
    });
}

test('a mid-wrap cwd change cannot open the new link in the first physical row directory', async () => {
    await fixture(
        false,
        async (view) => {
            await view.evaluate('window.sizes.local({cols:10,rows:14})');
            await view.evaluate(
                `window.writeOutput('local', '\\x1b]7;file://fixture/repo/worktree\\x07prefixprefixprefix \\x1b]7;file://fixture/repo/worktree/nested\\x07same.ts:12:4-16')`
            );
            await assertRefused(view, 2);
            await view.evaluate(`window.writeOutput('local', '\\r\\nsame.ts:12:4-16\\r\\n')`);
            await click(view, await hover(view, 'local', 4), 'left', modifier);
            await expectLocation(view, '/repo/worktree/nested/same.ts');
            await click(view, await hover(view, 'local', 4), 'right');
            await menuOpen(view);
            await expectLocation(view, '/repo/worktree/nested/same.ts');
        },
        ''
    );
});

async function assertRefused(view: View, row: number): Promise<void> {
    await click(view, await hover(view, 'local', row), 'left', modifier);
    expect(await view.evaluate<unknown>('window.files.getState().tabs')).toEqual([]);
    expect(await view.evaluate<unknown>('window.reads')).toEqual([]);
    await click(view, await hover(view, 'local', row), 'right');
    expect(
        await view.evaluate<boolean>(`[...document.querySelectorAll('[role=menuitem]')].some(item=>item.textContent.includes('Open file in preview'))`)
    ).toBe(false);
    await view.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await view.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
}

test('returning from a cursor-addressed TUI preserves older normal output and leaves new output unknown', async () => {
    await fixture(
        false,
        async (view) => {
            await view.evaluate(
                `window.writeOutput('local', '\\x1b[?1049h\\x1b[H\\x1b[2J\\x1b]7;file://fixture/repo/worktree/nested\\x07same.ts:12:4-16\\x1b[?1049l')`
            );
            await click(view, await hover(view, 'local', 0), 'left', modifier);
            await expectLocation(view, '/repo/worktree/same.ts');
            await click(view, await hover(view, 'local', 0), 'right');
            await menuOpen(view);
            await expectLocation(view, '/repo/worktree/same.ts');
            await view.evaluate(`window.writeOutput('local', 'same.ts:12:4-16\\r\\n')`);
            const nonce = await view.evaluate<number>('window.files.getState().revealLine.nonce');
            await click(view, await hover(view, 'local', 1), 'left', modifier);
            expect(await view.evaluate<number>('window.files.getState().revealLine.nonce')).toBe(nonce);
            await click(view, await hover(view, 'local', 1), 'right');
            expect(
                await view.evaluate<boolean>(`[...document.querySelectorAll('[role=menuitem]')].some(item=>item.textContent.includes('Open file in preview'))`)
            ).toBe(false);
        },
        '\x1b]7;file://fixture/repo/worktree\x07same.ts:12:4-16\r\n'
    );
});
