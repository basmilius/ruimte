import { expect, test } from 'bun:test';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { clientDirectory, withBrowserFixture } from '../../testing/browser-fixture';

type View = InstanceType<typeof Bun.WebView>;
const github = 'https://github.com/basmilius/ruimte';
const localhost = 'http://localhost:5173';
const wrapped = `${github}/issues/123?query=${'abcdefghij'.repeat(12)}&end=complete`;
const output = `${github}\r\n${localhost}\r\n${wrapped}\r\n\x1b]8;;${github}/pull/12\x1b\\Pull request\x1b]8;;\x1b\\\r\n/tmp/example.ts:12\r\n\x1b]8;;file:///tmp/example.ts\x1b\\Local file\x1b]8;;\x1b\\\r\n\x1b]8;;javascript:alert(1)\x1b\\Unsafe link\x1b]8;;\x1b\\`;
const frame = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))';

async function fixture(platform: 'darwin' | 'linux' | 'browser', shared: boolean, run: (view: View) => Promise<void>): Promise<void> {
    const apple = platform === 'darwin' || (platform === 'browser' && process.platform === 'darwin');
    const css = await readFile(join(clientDirectory, 'node_modules/@xterm/xterm/css/xterm.css'), 'utf8');
    const terminalCss = await readFile(join(clientDirectory, 'node_modules/@adecore/terminal/src/terminal.css'), 'utf8');
    await withBrowserFixture(
        `
        import { TerminalView } from ${JSON.stringify(join(clientDirectory, 'node_modules/@adecore/terminal/src/TerminalView.tsx'))};
        import { MachineTerminal } from ${JSON.stringify(join(import.meta.dir, 'MachineTerminal.tsx'))};
        import { useEndpoints } from ${JSON.stringify(join(import.meta.dir, '../state/endpoints.ts'))};
        import { useToasts } from ${JSON.stringify(join(import.meta.dir, '../state/toasts.ts'))};
        import { useSettings } from ${JSON.stringify(join(import.meta.dir, '../state/settings.ts'))};
        import { useWindow } from ${JSON.stringify(join(import.meta.dir, '../state/window.ts'))};
        import { useDocument } from ${JSON.stringify(join(import.meta.dir, '../state/document.ts'))};
        import { defaultCanvases } from ${JSON.stringify(join(import.meta.dir, '../state/canvas.ts'))};
        import { TerminalPane } from ${JSON.stringify(join(import.meta.dir, '../shell/settings/panes/TerminalPane.tsx'))};
        import settingsWords from ${JSON.stringify(join(import.meta.dir, '../i18n/locales/en/settings.json'))};
        import words from ${JSON.stringify(join(import.meta.dir, '../i18n/locales/en/canvas.json'))};
        i18next.addResourceBundle('en', 'canvas', words, true, true);
        i18next.addResourceBundle('en', 'settings', settingsWords, true, true);
        Object.defineProperty(navigator, 'userAgent', {value: ${JSON.stringify(apple ? 'Macintosh' : 'Linux')}, configurable:true});
        window.opened = []; window.popups = []; window.handled = []; window.instances = {}; window.toasts = useToasts;
        Object.defineProperty(navigator, 'userAgentData', { value: {platform: ${JSON.stringify(apple ? 'macOS' : 'Linux')}}, configurable: true });
        Object.defineProperty(navigator, 'platform', { value: ${JSON.stringify(apple ? 'MacIntel' : 'Linux x86_64')}, configurable: true });
        ${platform === 'browser' ? '' : `window.ruimteDesktop = { platform: '${platform}', openExternal: async uri => window.opened.push(uri) };`}
        // The shell denies popups and forwards only requests that already carry a web URL.
        window.open = (uri = 'about:blank', ...options) => {
            window.popups.push([uri, ...options]);
            if (/^https?:/.test(uri)) window.opened.push(uri);
            return null;
        };
        ${
            platform === 'linux' && process.platform === 'darwin'
                ? `// macOS emits a context menu for Ctrl+click even with a Linux navigator.
        document.addEventListener('contextmenu', event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);`
                : ''
        }
        useEndpoints.setState({ activeId: 'elsewhere', endpoints: [{id:'local',label:'This computer'}, {id:'remote',label:'Build server'}] });
        window.settings = useSettings; window.project = useDocument; window.canvases = defaultCanvases; window.windowState = useWindow;
        window.setupProject = (endpointId, onCanvas) => {
            const terminal = {id:'terminal-'+endpointId,kind:'terminal',title:'Links',x:40,y:64,w:600,h:360};
            const main = {id:'main',kind:'canvas',name:'Main',nodes:onCanvas?[terminal]:[],texts:[],edges:[],layouts:[]};
            const other = {...main,id:'other',name:'Other',nodes:[]};
            const standalone = {id:terminal.id,kind:'terminal',name:'Links',node:{}};
            useDocument.getState().load({version:3,rev:1,name:'Links',color:'#000',views:[main,other,...(onCanvas?[]:[standalone])]}, {activeViewId:'main',views:{}});
            defaultCanvases.of('main').getState().loadView(main,null);
            defaultCanvases.of('other').getState().loadView(other,null);
            useDocument.getState().splitFocused('right','other');
            defaultCanvases.focus('other');
            useWindow.getState().show({kind:'workspace',workspace:{connection:{endpointId}}});
        };
        window.showLinkSettings = () => {
            const element = document.createElement('div'); element.className='settings'; document.body.append(element);
            const root=createRoot(element); root.render(<UIProvider i18n={i18next}><TerminalPane/></UIProvider>);
            window.hideLinkSettings=()=>{root.unmount();element.remove();};
        };
        const Component = ${shared ? 'TerminalView' : 'MachineTerminal'};
        let ready;
        function Pane({ id, generation, handler }) {
            const ref = React.useRef(null);
            React.useEffect(() => {
                window.instances[id] = ref.current;
                ref.current.write(${JSON.stringify(output)}, () => ready?.(id));
            }, []);
            return <Component ref={ref} endpointId={id} sourceId={'terminal-'+id} className={'pane ' + id} scaledByAncestor
                ${shared ? 'onOpenLink={handler ? (uri) => window.handled.push([id, handler, uri]) : undefined}' : ''} />;
        }
        function Fixture() {
            const [generation, setGeneration] = React.useState(0);
            const [handler, setHandler] = React.useState(null);
            window.setHandler = setHandler;
            window.remount = () => new Promise(resolve => { let count = 0; ready = () => {if (++count === 2) resolve()}; setGeneration(value=>value+1); });
            return <><Pane key={'local'+generation} id="local" generation={generation} handler={handler}/><Pane key={'remote'+generation} id="remote" generation={generation} handler={handler}/></>;
        }
        window.ready = new Promise(resolve => { let count = 0; ready = () => {if (++count === 2) resolve()}; });
        window.root = createRoot(document.getElementById('root'));
        window.root.render(<UIProvider i18n={i18next}><Fixture/></UIProvider>);
    `,
        `${css}\n${terminalCss}\n.pane{position:absolute;width:360px;height:300px;top:0}.remote{left:400px}.settings{position:absolute;top:0;left:0;width:780px;background:white;z-index:2}svg{width:14px;height:14px}.absolute{position:absolute}.inset-0{inset:0}.pointer-events-none{pointer-events:none}.tooltip-popup{max-width:288px;overflow-wrap:anywhere;font:12px sans-serif}.truncate{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}`,
        async (view) => {
            await view.evaluate('window.ready');
            await view.evaluate(frame);
            await run(view);
            expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
        }
    );
}

async function pointAt(view: View, id: string, row: number, column = 1): Promise<{ x: number; y: number }> {
    return view.evaluate(`(() => {
        const term = window.instances[${JSON.stringify(id)}].terminal;
        const rect = term.element.querySelector('.xterm-screen').getBoundingClientRect();
        const cell = term._core._renderService.dimensions.css.cell;
        const scale = rect.width / (term.cols * cell.width);
        return {x:rect.x + cell.width * (${column}+0.5) * scale,y:rect.y + cell.height * (${row}+0.5) * scale};
    })()`);
}

async function hover(view: View, id: string, row: number): Promise<{ x: number; y: number }> {
    await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 790, y: 590 });
    const point = await pointAt(view, id, row);
    await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x - 9, y: point.y });
    await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await view.evaluate(frame);
    return point;
}

async function click(view: View, point: { x: number; y: number }, modifiers: number): Promise<void> {
    await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1, modifiers });
    await view.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1, modifiers });
}

for (const platform of ['darwin', 'linux', 'browser'] as const) {
    test(`terminal web links follow the ${platform} route and preserve selection`, async () => {
        await fixture(platform, false, async (view) => {
            const apple = platform === 'darwin' || (platform === 'browser' && process.platform === 'darwin');
            const modifier = apple ? 4 : 2;
            const first = await hover(view, 'local', 0);
            expect(await view.evaluate<string>(`getComputedStyle(document.querySelector('.local .xterm-screen')).cursor`)).toBe('pointer');
            expect(
                await view.evaluate<boolean>(
                    `[...document.querySelectorAll('.local .xterm-rows span')].some(node=>getComputedStyle(node).textDecorationLine.includes('underline'))`
                )
            ).toBe(true);
            expect(await view.evaluate<string>(`document.querySelector('[role=tooltip]').textContent`)).toContain(apple ? '⌘+click' : 'Ctrl+click');
            expect(await view.evaluate<string>(`getComputedStyle(document.querySelector('[role=tooltip]').closest('.tooltip-positioner')).pointerEvents`)).toBe(
                'none'
            );
            await view.evaluate(
                `Promise.all([...document.querySelectorAll('.tooltip-positioner,.tooltip-popup')].flatMap(element=>element.getAnimations()).map(animation=>animation.finished.catch(()=>undefined)))`
            );
            const tooltipBox = await view.evaluate<{ x: number; y: number; width: number; height: number }>(
                `document.querySelector('.tooltip-positioner').getBoundingClientRect().toJSON()`
            );
            const linkBox = await view.evaluate<{ left: number; top: number; right: number; bottom: number }>(`(() => {
                const term=window.instances.local.terminal;
                const rect=term.element.querySelector('.xterm-screen').getBoundingClientRect();
                return {left:rect.left,top:rect.top,right:rect.left+rect.width/term.cols*${github.length},bottom:rect.top+rect.height/term.rows};
            })()`);
            expect(tooltipBox.x + tooltipBox.width / 2).toBeCloseTo((linkBox.left + linkBox.right) / 2, 0);
            expect(tooltipBox.y >= linkBox.bottom || tooltipBox.y + tooltipBox.height <= linkBox.top).toBe(true);
            await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...(await pointAt(view, 'local', 0, 18)) });
            await view.evaluate(frame);
            const movedBox = await view.evaluate<{ x: number; y: number }>(`document.querySelector('.tooltip-positioner').getBoundingClientRect().toJSON()`);
            expect(movedBox.x).toBe(tooltipBox.x);
            expect(movedBox.y).toBe(tooltipBox.y);
            await click(view, first, 0);
            expect(await view.evaluate<string[]>('window.opened')).toEqual([]);
            expect(await view.evaluate<boolean>(`document.activeElement === window.instances.local.terminal.textarea`)).toBe(true);
            await click(view, await hover(view, 'local', 0), modifier);
            expect(await view.evaluate<string[]>('window.opened')).toEqual([github]);
            await click(view, await hover(view, 'local', 1), modifier);
            const expected = platform === 'browser' ? [github] : [github, localhost];
            expect(await view.evaluate<string[]>('window.opened')).toEqual(expected);
            if (platform === 'browser') {
                expect(await view.evaluate<string>('window.toasts.getState().toasts[0].description')).toContain('does not forward');
            }
            const rows = await view.evaluate<number>('Math.ceil(' + wrapped.length + '/window.instances.local.terminal.cols)');
            for (let row = 2; row < 2 + rows; row++) {
                const point = await hover(view, 'local', row);
                expect(await view.evaluate<string>(`document.querySelector('[role=tooltip]').textContent`)).toContain(wrapped);
                await click(view, point, modifier);
                expected.push(wrapped);
                expect(await view.evaluate<string[]>('window.opened')).toEqual(expected);
            }
            // OSC 8 uses the same web route, even though its displayed label is not its URL.
            await click(view, await hover(view, 'local', 2 + rows), modifier);
            expected.push(`${github}/pull/12`);
            expect(await view.evaluate<string[]>('window.opened')).toEqual(expected);
            for (const row of [3 + rows, 4 + rows, 5 + rows]) {
                await click(view, await hover(view, 'local', row), modifier);
            }
            expect(await view.evaluate<string[]>('window.opened')).toEqual(expected);
            for (const modifiers of [0, modifier]) {
                const start = await hover(view, 'local', 0);
                const end = await pointAt(view, 'local', 0, 18);
                await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1, modifiers });
                await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...end, button: 'left', buttons: 1, modifiers });
                await view.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', buttons: 0, clickCount: 1, modifiers });
                expect(await view.evaluate<string[]>('window.opened')).toEqual(expected);
                if (modifiers === 0) {
                    expect(await view.evaluate<string>('window.instances.local.selection()')).not.toBe('');
                }
                await view.evaluate('window.instances.local.terminal.clearSelection()');
            }
            await click(view, await hover(view, 'remote', 0), modifier);
            expected.push(github);
            expect(await view.evaluate<string[]>('window.opened')).toEqual(expected);
            const remote = await hover(view, 'remote', 1);
            expect(await view.evaluate<string>(`document.querySelector('[role=tooltip]').textContent`)).toContain('Build server');
            await click(view, remote, modifier);
            expect(await view.evaluate<string[]>('window.opened')).toEqual(expected);
            expect(await view.evaluate<string>('window.toasts.getState().toasts.at(-1).description')).toContain('does not forward');
            await view.evaluate('window.remount()');
            await click(view, await hover(view, 'local', 0), modifier);
            expected.push(github);
            expect(await view.evaluate<string[]>('window.opened')).toEqual(expected);
            const popups = await view.evaluate<string[][]>('window.popups');
            expect(popups).toEqual(platform === 'browser' ? expected.map((uri) => [uri, '_blank', 'noopener,noreferrer']) : []);
            await view.evaluate('window.root.unmount()');
            expect(await view.evaluate<number>(`document.querySelectorAll('.xterm').length`)).toBe(0);
        });
    }, 15000);
}

test('shared terminal fallback includes the URL immediately and handlers follow each instance through updates', async () => {
    await fixture('browser', true, async (view) => {
        await click(view, await hover(view, 'local', 0), 0);
        expect(await view.evaluate<string[][]>('window.popups')).toEqual([[github, '_blank', 'noopener,noreferrer']]);
        await view.evaluate(`window.setHandler('first')`);
        await view.evaluate(frame);
        await click(view, await hover(view, 'local', 0), 0);
        await click(view, await hover(view, 'remote', 1), 0);
        await view.evaluate(`window.setHandler('second')`);
        await view.evaluate(frame);
        await click(view, await hover(view, 'remote', 0), 0);
        expect(await view.evaluate<string[][]>('window.handled')).toEqual([
            ['local', 'first', github],
            ['remote', 'first', localhost],
            ['remote', 'second', github]
        ]);
        await view.evaluate('window.setHandler(null)');
        await view.evaluate(frame);
        await click(view, await hover(view, 'local', 0), 0);
        expect(await view.evaluate<string[][]>('window.popups')).toHaveLength(2);
    });
}, 15000);

for (const platform of ['darwin', 'browser'] as const) {
    test(`the terminal destination setting creates views and nodes in ${platform}`, async () => {
        await fixture(platform, false, async (view) => {
            const modifier = platform === 'darwin' || process.platform === 'darwin' ? 4 : 2;
            await view.evaluate('(() => { window.setupProject("local", false); window.showLinkSettings(); })()');
            await view.evaluate(frame);
            const choice = await view.evaluate<{ x: number; y: number }>(`(() => {
                const button = [...document.querySelectorAll('[role=radio]')].find(element=>element.textContent==='Ruimte');
                const rect=button.getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
            })()`);
            await click(view, choice, 0);
            await view.evaluate(frame);
            expect(await view.evaluate<string>('window.settings.getState().terminalLinkDestination')).toBe('ruimte');
            await view.evaluate('window.hideLinkSettings()');
            const first = await hover(view, 'local', 0);
            expect(await view.evaluate<string>(`document.querySelector('[role=tooltip]').textContent`)).toContain('open in Ruimte');
            const views = 'window.project.getState().views.filter(view=>view.kind==="browser").map(view=>view.url)';
            await click(view, first, 0);
            expect(await view.evaluate<string[]>(views)).toEqual([]);
            await click(view, await hover(view, 'local', 0), modifier);
            await view.evaluate(frame);
            expect(await view.evaluate<string[]>(views)).toEqual([github]);
            const rows = await view.evaluate<number>('Math.ceil(' + wrapped.length + '/window.instances.local.terminal.cols)');
            await click(view, await hover(view, 'local', 2 + rows - 1), modifier);
            await view.evaluate(frame);
            expect(await view.evaluate<string[]>(views)).toEqual([github, wrapped]);
            expect(await view.evaluate<string[]>('window.opened')).toEqual([]);

            await view.evaluate('window.setupProject("local", true)');
            await click(view, await hover(view, 'local', 0), modifier);
            await view.evaluate(frame);
            expect(
                await view.evaluate<{ url: string; x: number; y: number }[]>(
                    'Object.values(window.canvases.of("main").getState().nodes).filter(node=>node.kind==="browser").map(node=>({url:node.url,x:node.x,y:node.y}))'
                )
            ).toEqual([{ url: github, x: 672, y: 64 }]);
            expect(await view.evaluate<string[]>('Object.keys(window.canvases.of("other").getState().nodes)')).toEqual([]);
            expect(await view.evaluate<string[]>(views)).toEqual([]);

            // A login on another machine cannot put a view into the current machine's project.
            await click(view, await hover(view, 'remote', 0), modifier);
            expect(await view.evaluate<string[]>('window.opened')).toEqual([github]);
            await view.evaluate('window.setupProject("remote", true)');
            await click(view, await hover(view, 'remote', 1), modifier);
            expect(await view.evaluate<string>('window.toasts.getState().toasts.at(-1).description')).toContain('does not forward');
            expect(await view.evaluate<string[]>('Object.keys(window.canvases.of("main").getState().nodes)')).toEqual(['terminal-remote']);
            await click(view, await hover(view, 'remote', 0), modifier);
            await view.evaluate(frame);
            expect(
                await view.evaluate<string[]>(
                    'Object.values(window.canvases.of("main").getState().nodes).filter(node=>node.kind==="browser").map(node=>node.url)'
                )
            ).toEqual([github]);

            await view.evaluate('window.settings.getState().update({terminalLinkDestination:"external"})');
            await click(view, await hover(view, 'remote', 0), modifier);
            expect(await view.evaluate<string[]>('window.opened')).toEqual([github, github]);
            expect(await view.evaluate<string>(`document.querySelector('[role=tooltip]').textContent`)).toContain('open in your browser');
        });
    }, 15000);
}

test('TerminalBody links work through canvas focus, zoom, selection and dragging', async () => {
    const css = await readFile(join(clientDirectory, 'node_modules/@xterm/xterm/css/xterm.css'), 'utf8');
    const terminalCss = await readFile(join(clientDirectory, 'node_modules/@adecore/terminal/src/terminal.css'), 'utf8');
    const terminalPackage = await realpath(join(clientDirectory, 'node_modules/@adecore/terminal'));
    await withBrowserFixture(
        `
        import { Terminal } from ${JSON.stringify(Bun.resolveSync('@xterm/xterm', terminalPackage))};
        import { Canvas } from ${JSON.stringify(join(import.meta.dir, '../canvas/Canvas.tsx'))};
        import { useCanvasShortcuts } from ${JSON.stringify(join(import.meta.dir, '../canvas/canvas-shortcuts.ts'))};
        import { defaultCanvasStore } from ${JSON.stringify(join(import.meta.dir, '../state/canvas.ts'))};
        import { ChatScopeProvider } from ${JSON.stringify(join(import.meta.dir, '../transport/ChatScopeProvider.tsx'))};
        import { ConnectionContext } from ${JSON.stringify(join(import.meta.dir, '../transport/context.ts'))};
        import { machineFor } from ${JSON.stringify(join(import.meta.dir, '../transport/connections.ts'))};
        import { transport } from ${JSON.stringify(join(import.meta.dir, '../transport/index.ts'))};
        import { useEndpoints } from ${JSON.stringify(join(import.meta.dir, '../state/endpoints.ts'))};
        import words from ${JSON.stringify(join(import.meta.dir, '../i18n/locales/en/canvas.json'))};
        i18next.addResourceBundle('en', 'canvas', words, true, true);
        window.opened=[]; window.input=[]; window.instances={};
        window.ruimteDesktop={platform:${JSON.stringify(process.platform)},openExternal:async uri=>window.opened.push(uri)};
        useEndpoints.setState({activeId:'local',endpoints:[{id:'local',label:'This computer'}]});
        const machine=machineFor('local');
        machine.sessions.open=async(id, options, cols, rows)=>({cols,rows,screen:${JSON.stringify(output)}});
        machine.sessions.write=(id,data)=>window.input.push(data);
        machine.sessions.resize=()=>{};
        machine.sessions.detach=async()=>{};
        Object.defineProperty(transport,'status',{get:()=> 'open'});
        window.ready=new Promise(resolve=>{
            const write=Terminal.prototype.write;
            Terminal.prototype.write=function(data,done){
                return write.call(this,data,()=>{done?.(); if(data===${JSON.stringify(output)}) {window.instances.canvas={terminal:this};resolve();}});
            };
        });
        defaultCanvasStore.setState({viewId:'fixture',nodes:{a:{id:'a',kind:'terminal',title:'Links',x:40,y:40,w:600,h:360}},texts:{},order:['a'],camera:{x:0,y:0,zoom:0.8},selection:[],bodyFocusId:null});
        window.canvas=defaultCanvasStore;
        function Fixture(){useCanvasShortcuts();return <Canvas/>;}
        createRoot(document.getElementById('root')).render(<UIProvider i18n={i18next}><ConnectionContext.Provider value={{...machine}}><ChatScopeProvider><Fixture/></ChatScopeProvider></ConnectionContext.Provider></UIProvider>);
    `,
        `${css}\n${terminalCss}\n.absolute{position:absolute}.relative{position:relative}.inset-0{inset:0}.flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1}.grow{flex-grow:1}.min-h-0{min-height:0}.h-full{height:100%}.pointer-events-none{pointer-events:none}.pointer-events-auto{pointer-events:auto}.overflow-hidden{overflow:hidden}[data-node-id]>header{height:39px;flex-shrink:0}[data-canvas-surface]{position:relative;width:800px;height:600px;overflow:hidden}svg{width:14px;height:14px}.tooltip-popup{max-width:288px;overflow-wrap:anywhere;font:12px sans-serif}.truncate{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}`,
        async (view) => {
            await view.evaluate('window.ready');
            await view.evaluate(frame);
            const modifier = process.platform === 'darwin' ? 4 : 2;
            const first = await hover(view, 'canvas', 0);
            await click(view, first, 0);
            await view.evaluate(frame);
            expect(await view.evaluate<string[]>('window.opened')).toEqual([]);
            expect(await view.evaluate<string>('window.canvas.getState().bodyFocusId')).toBe('a');
            expect(await view.evaluate<boolean>('document.activeElement===window.instances.canvas.terminal.textarea')).toBe(true);
            await click(view, await hover(view, 'canvas', 0), modifier);
            expect(await view.evaluate<string[]>('window.opened')).toEqual([github]);
            const rows = await view.evaluate<number>('Math.ceil(' + wrapped.length + '/window.instances.canvas.terminal.cols)');
            const last = await hover(view, 'canvas', 2 + rows - 1);
            await click(view, last, modifier);
            expect(await view.evaluate<string[]>('window.opened')).toEqual([github, wrapped]);
            const start = await hover(view, 'canvas', 0);
            const end = await pointAt(view, 'canvas', 0, 18);
            await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 });
            await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...end, button: 'left', buttons: 1 });
            await view.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', buttons: 0, clickCount: 1 });
            expect(await view.evaluate<string>('window.instances.canvas.terminal.getSelection()')).not.toBe('');
            expect(await view.evaluate<string[]>('window.opened')).toEqual([github, wrapped]);
            const header = await view.evaluate<{ x: number; y: number }>(
                `(()=>{const rect=document.querySelector('[data-node-id=a]>header').getBoundingClientRect();return {x:rect.x+150,y:rect.y+20}})()`
            );
            await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...header });
            await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...header, button: 'left', buttons: 1, clickCount: 1 });
            await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: header.x + 80, y: header.y + 40, button: 'left', buttons: 1 });
            await view.cdp('Input.dispatchMouseEvent', {
                type: 'mouseReleased',
                x: header.x + 80,
                y: header.y + 40,
                button: 'left',
                buttons: 0,
                clickCount: 1
            });
            expect(await view.evaluate<number>('window.canvas.getState().nodes.a.x')).toBeGreaterThan(40);
            expect(await view.evaluate<string[]>('window.opened')).toEqual([github, wrapped]);
            await view.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'x', code: 'KeyX', text: 'x' });
            await view.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'x', code: 'KeyX' });
            expect(await view.evaluate<string[]>('window.input')).toContain('x');
            expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
        }
    );
}, 15000);
