import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { withBrowserFixture } from '../../testing/browser-fixture';

test('connector labels stay over every path and remain editable in the browser', async () => {
    await withBrowserFixture(
        `
        import { EdgeLayer } from ${JSON.stringify(join(import.meta.dir, 'EdgeLayer.tsx'))};
        import { defaultCanvasStore } from ${JSON.stringify(join(import.meta.dir, '../state/canvas.ts'))};
        defaultCanvasStore.setState({
            nodes: {
                a: { id: 'a', kind: 'note', title: 'A', x: 10, y: 10, w: 100, h: 100 },
                b: { id: 'b', kind: 'note', title: 'B', x: 450, y: 10, w: 100, h: 100 },
                c: { id: 'c', kind: 'note', title: 'C', x: 10, y: 400, w: 100, h: 100 }
            },
            edges: [{ id: 'ab', from: 'a', to: 'b', label: 'First label' }, { id: 'ac', from: 'a', to: 'c', label: 'Second label' }],
            texts: {}, selection: [], hidden: new Set(), linkDraft: { from: 'b', to: { x: 600, y: 500 } }
        });
        window.canvas = defaultCanvasStore;
        createRoot(document.getElementById('root')).render(React.createElement(UIProvider, { i18n: i18next }, React.createElement(EdgeLayer)));
    `,
        'svg{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}foreignObject{overflow:visible}foreignObject span,input{pointer-events:auto;background:white}foreignObject div{display:flex;justify-content:center;align-items:center;height:32px}path.cursor-pointer{pointer-events:stroke}',
        async (view) => {
            expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
            expect(await view.evaluate<number>('document.querySelectorAll("foreignObject").length')).toBe(2);
            expect(
                await view.evaluate<boolean>(`(() => {
            const label = document.querySelector('foreignObject span');
            const rect = label.getBoundingClientRect();
            const x = rect.x + rect.width / 2;
            const y = rect.y + rect.height / 2;
            document.querySelectorAll('path.cursor-pointer')[1].setAttribute('d', 'M' + (x - 100) + ' ' + y + 'H' + (x + 100));
            return document.elementFromPoint(x, y) === label;
        })()`)
            ).toBe(true);
            expect(
                await view.evaluate<boolean>(`(() => {
            const lines = document.querySelector('[data-edge-layer="lines"]');
            const labels = document.querySelector('[data-edge-layer="labels"]');
            return !!lines && !!labels && !!(lines.compareDocumentPosition(labels) & Node.DOCUMENT_POSITION_FOLLOWING) && !lines.querySelector('foreignObject') && !labels.querySelector('path');
        })()`)
            ).toBe(true);
            await view.evaluate(`document.querySelector('foreignObject span').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))`);
            await view.evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
            expect(await view.evaluate<boolean>('document.activeElement instanceof HTMLInputElement')).toBe(true);
            await view.evaluate(`(() => { const input = document.querySelector('input'); input.value = 'Edited'; input.blur(); })()`);
            expect(await view.evaluate<string>('window.canvas.getState().edges[0].label')).toBe('Edited');
        }
    );
}, 15000);

test('the canvas keeps selection anchored during scroll, pans over focused bodies and edits gaps', async () => {
    await withBrowserFixture(
        `
        import { Canvas } from ${JSON.stringify(join(import.meta.dir, 'Canvas.tsx'))};
        import { useCanvasShortcuts } from ${JSON.stringify(join(import.meta.dir, 'canvas-shortcuts.ts'))};
        import { defaultCanvasStore } from ${JSON.stringify(join(import.meta.dir, '../state/canvas.ts'))};
        import { ChatScopeProvider } from ${JSON.stringify(join(import.meta.dir, '../transport/ChatScopeProvider.tsx'))};
        import { ConnectionContext } from ${JSON.stringify(join(import.meta.dir, '../transport/context.ts'))};
        import { machineTransport } from ${JSON.stringify(join(import.meta.dir, '../transport/index.ts'))};
        defaultCanvasStore.setState({ viewId: 'fixture', nodes: { initial: {id:'initial',kind:'group',title:'Initial',x:650,y:450,w:100,h:100} }, texts: {}, order: ['initial'] });
        window.canvas = defaultCanvasStore;
        function Fixture() { useCanvasShortcuts(); return React.createElement(Canvas); }
        createRoot(document.getElementById('root')).render(React.createElement(UIProvider, {i18n:i18next}, React.createElement(ConnectionContext.Provider, {value:{endpointId:'fixture',transport:machineTransport('fixture')}}, React.createElement(ChatScopeProvider, null, React.createElement(Fixture)))));
    `,
        '.absolute{position:absolute}.relative{position:relative}.inset-0{inset:0}.pointer-events-none{pointer-events:none}.pointer-events-auto{pointer-events:auto}[data-canvas-surface]{position:relative;width:800px;height:600px;overflow:hidden}[data-gap-id]{transform:translate(-50%,-50%)}svg{overflow:visible}',
        async (view) => {
            await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 100, y: 100, button: 'left', buttons: 1, clickCount: 1 });
            await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 250, y: 200, button: 'left', buttons: 1 });
            await view.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 250, y: 200, deltaX: 100, deltaY: 0 });
            await view.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
            expect(await view.evaluate<number>('window.canvas.getState().camera.x')).toBe(-100);
            expect(await view.evaluate<string>(`document.querySelector('[data-canvas-surface] [class*="border-accent"]').style.left`)).toBe('0px');
            await view.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 250, y: 200, button: 'left', buttons: 0, clickCount: 1 });

            await view.evaluate(`(() => {
            const root = document.querySelector('[data-canvas-surface]');
            const body = document.createElement('div');
            body.dataset.nodeBody = '';
            const frame = document.createElement('div'); frame.dataset.nodeId = 'focused';
            frame.append(body); root.append(frame);
            window.canvas.setState({bodyFocusId:'focused', camera:{x:0,y:0,zoom:1}});
            window.nodeWheels = 0; body.addEventListener('wheel', () => window.nodeWheels++);
            window.body = body;
            root.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:20}));
            body.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:30}));
        })()`);
            await view.evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
            expect(await view.evaluate<number>('window.canvas.getState().camera.x')).toBe(-50);
            expect(await view.evaluate<number>('window.nodeWheels')).toBe(0);
            await view.evaluate('new Promise(resolve => setTimeout(resolve, 180))');
            await view.evaluate(`window.body.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:30}))`);
            expect(await view.evaluate<number>('window.nodeWheels')).toBe(1);

            await view.evaluate(`(() => { window.body.parentElement.remove(); window.canvas.setState({
            bodyFocusId:null, camera:{x:0,y:0,zoom:1},
            nodes:{a:{id:'a',kind:'group',title:'A',x:20,y:300,w:100,h:100},b:{id:'b',kind:'group',title:'B',x:152,y:300,w:100,h:100},c:{id:'c',kind:'group',title:'C',x:284,y:300,w:100,h:100}},
            selection:['a','b','c'], order:['a','b','c']
        }); })()`);
            await view.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 1 });
            await view.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
            expect(
                await view.evaluate<string | null>(`document.elementFromPoint(136, 350)?.closest('[data-gap-id]')?.getAttribute('data-gap-id') ?? null`)
            ).toBe('x:a:b');
            expect(await view.evaluate<number>('document.querySelectorAll("[data-gap-id]").length')).toBe(2);
            await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 136, y: 350, button: 'left', buttons: 1, clickCount: 1, modifiers: 1 });
            await view.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 });
            await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 152, y: 350, button: 'left', buttons: 1 });
            await view.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 152, y: 350, button: 'left', buttons: 0, clickCount: 1 });
            expect(await view.evaluate<number[]>('Object.values(window.canvas.getState().nodes).map(node=>node.x)')).toEqual([20, 168, 316]);
            expect(await view.evaluate<number>('window.canvas.getState().past.length')).toBe(1);
            expect(await view.evaluate<string[]>('window.canvas.getState().selection')).toEqual(['a', 'b', 'c']);
            await view.evaluate('window.canvas.getState().undo()');
            expect(await view.evaluate<number[]>('Object.values(window.canvas.getState().nodes).map(node=>node.x)')).toEqual([20, 152, 284]);
            await view.evaluate("window.canvas.getState().select(['a', 'b', 'c'])");
            await view.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 1 });
            await view.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
            expect(
                await view.evaluate<string | null>(`document.elementFromPoint(136, 350)?.closest('[data-gap-id]')?.getAttribute('data-gap-id') ?? null`)
            ).toBe('x:a:b');
            await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 136, y: 350, button: 'left', buttons: 1, clickCount: 1, modifiers: 1 });
            expect(await view.evaluate<boolean>('window.canvas.getState().gapMove !== null')).toBe(true);
            await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 168, y: 350, button: 'left', buttons: 1, modifiers: 1 });
            expect(await view.evaluate<number[]>('Object.values(window.canvas.getState().nodes).map(node=>node.x)')).toEqual([20, 184, 348]);
            await view.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 });
            await view.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
            await view.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 168, y: 350, button: 'left', buttons: 0, clickCount: 1 });
            expect(await view.evaluate<number[]>('Object.values(window.canvas.getState().nodes).map(node=>node.x)')).toEqual([20, 152, 284]);
            expect(await view.evaluate<number>('window.canvas.getState().past.length')).toBe(0);
            expect(await view.evaluate<string[]>('window.canvas.getState().selection')).toEqual(['a', 'b', 'c']);
            await view.evaluate("window.canvas.getState().select(['a'])");
            await view.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 1 });
            expect(await view.evaluate<string[]>('window.canvas.getState().selection')).toEqual(['b']);
            await view.evaluate('window.canvas.setState({camera:{x:-300,y:0,zoom:0.5}})');
            const modifiers = await view.evaluate<number>('/Mac/.test(navigator.platform) ? 12 : 10');
            await view.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: '@', code: 'Digit2', windowsVirtualKeyCode: 50, modifiers });
            expect(await view.evaluate<number>('window.canvas.getState().camera.zoom')).toBe(1);
            expect(await view.evaluate<string[]>('window.canvas.getState().selection')).toEqual(['b']);

            await view.evaluate('(() => { window.canvas.getState().clearSelection(); window.canvas.setState({camera:{x:0,y:0,zoom:1}}); })()');
            await view.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 1 });
            await view.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
            expect(await view.evaluate<number>('document.querySelectorAll("[data-gap-id]").length')).toBe(2);
            await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 136, y: 350, button: 'left', buttons: 1, clickCount: 1, modifiers: 1 });
            expect(await view.evaluate<string[]>('window.canvas.getState().heldNodeIds().sort()')).toEqual(['a', 'b', 'c']);
            await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 120, y: 350, button: 'left', buttons: 1, modifiers: 1 });
            await view.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 120, y: 350, button: 'left', buttons: 0, clickCount: 1, modifiers: 1 });
            expect(await view.evaluate<number[]>('Object.values(window.canvas.getState().nodes).map(node=>node.x)')).toEqual([20, 136, 252]);
            expect(await view.evaluate<string[]>(`[...document.querySelectorAll('[data-gap-id] span')].map(label=>label.textContent)`)).toEqual(['16', '16']);
            expect(await view.evaluate<string[]>('window.canvas.getState().selection')).toEqual([]);
            expect(await view.evaluate<number>('window.canvas.getState().past.length')).toBe(1);
            await view.evaluate('window.canvas.getState().undo()');
            expect(await view.evaluate<number[]>('Object.values(window.canvas.getState().nodes).map(node=>node.x)')).toEqual([20, 152, 284]);
            await view.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 });
            expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
        }
    );
}, 15000);
