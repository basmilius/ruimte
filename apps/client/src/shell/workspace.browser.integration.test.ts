import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { withBrowserFixture } from '../../testing/browser-fixture';

const frame = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))';

test('the linked workspace preserves grid gestures, tabs and view bodies', async () => {
    await withBrowserFixture(
        `
        import { Workspace } from ${JSON.stringify(Bun.resolveSync('@adecore/ui', join(import.meta.dir, '../..')))};
        import { SplitGrid } from ${JSON.stringify(join(import.meta.dir, 'SplitGrid.tsx'))};
        import { useDocument } from ${JSON.stringify(join(import.meta.dir, '../state/document.ts'))};
        import { useSettings } from ${JSON.stringify(join(import.meta.dir, '../state/settings.ts'))};
        import { cellElement } from ${JSON.stringify(join(import.meta.dir, 'cell-rects.ts'))};
        import { ChatScopeProvider } from ${JSON.stringify(join(import.meta.dir, '../transport/ChatScopeProvider.tsx'))};
        import { ConnectionContext } from ${JSON.stringify(join(import.meta.dir, '../transport/context.ts'))};
        import { machineTransport } from ${JSON.stringify(join(import.meta.dir, '../transport/index.ts'))};
        import { setDragging, VIEW_DRAG_TYPE } from ${JSON.stringify(join(import.meta.dir, 'view-drag.ts'))};
        const views = ['a','b','c','d'].map(id => ({kind:'canvas',id,name:id,nodes:[],texts:[],edges:[],layouts:[]}));
        const initial = {columns:[{size:0.2,cells:[{size:1,viewId:'a',tabs:['a','d']}]},{size:0.3,cells:[{size:1,viewId:'b'}]},{size:0.5,cells:[{size:1,viewId:'c'}]}],focus:{column:0,cell:0}};
        useDocument.getState().load({version:3,rev:1,name:'Fixture',color:'#000',views},{activeViewId:'a',views:{},layout:initial});
        window.fixture = {store:useDocument, settings:useSettings, cellElement, reset:() => useDocument.setState({layout:structuredClone(initial),maximized:null}), setDragging, mime:VIEW_DRAG_TYPE};
        function Fixture() {
            const layout=useSettings(state=>state.panelLayout);
            const [sides, setSides] = React.useState([false, false]);
            window.fixture.sides = setSides;
            const gap = layout === 'roomy' ? 8 : 0;
            return <Workspace layout={layout} toolbar={<div style={{height:47}}>Toolbar</div>}
                sidebarWidth="auto" sidebarOpen={sides[0]} sidebar={<aside style={{width:sides[0]?120+gap:0,overflow:'hidden',flexShrink:0}}><div style={{width:120,height:'100%',background:'var(--surface)'}}>Sidebar</div></aside>}
                sidePanelWidth="auto" sidePanelOpen={sides[1]} sidePanel={<aside style={{width:sides[1]?100+gap:0,overflow:'hidden',flexShrink:0,display:'flex',justifyContent:'end'}}><div style={{width:100,height:'100%',background:'var(--surface)'}}>Panel</div></aside>}
            ><SplitGrid /></Workspace>;
        }
        createRoot(document.getElementById('root')).render(<UIProvider i18n={i18next}><ConnectionContext.Provider value={{endpointId:'fixture',transport:machineTransport('fixture')}}><ChatScopeProvider><Fixture /></ChatScopeProvider></ConnectionContext.Provider></UIProvider>);
        `,
        `html,body,#root{margin:0;width:100%;height:100%}.flex{display:flex}.flex-col{flex-direction:column}.grow{flex-grow:1}.shrink-0{flex-shrink:0}.min-h-0{min-height:0}.min-w-0{min-width:0}.h-full{height:100%}.w-full{width:100%}.h-10{height:40px}.relative{position:relative}.absolute{position:absolute}.inset-0{inset:0}.overflow-hidden{overflow:hidden}.invisible{visibility:hidden}.hidden{display:none}.contents{display:contents}.items-center{align-items:center}.self-stretch{align-self:stretch}.pointer-events-none{pointer-events:none}.pointer-events-auto{pointer-events:auto}.split-cell-body{border-bottom-left-radius:inherit;border-bottom-right-radius:inherit}.split-cell-body:first-child{border-radius:inherit}`,
        async (view) => {
            await view.evaluate<unknown>(frame);
            expect(await view.evaluate<unknown>('document.querySelectorAll("[data-split-view-id]").length')).toBe(4);
            await view.evaluate<unknown>(
                '(() => {window.savedCanvas=document.querySelector("[data-split-view-id=a] [data-canvas-surface]");window.savedHost=document.querySelector("[data-split-view-id=a]")})()'
            );
            for (const layout of ['standard', 'roomy']) {
                await view.evaluate<unknown>(`(() => {fixture.reset();fixture.settings.setState({panelLayout:${JSON.stringify(layout)}})})()`);
                await view.evaluate<unknown>(frame);
                for (const left of [true, false]) {
                    for (const right of [true, false]) {
                        await view.evaluate<unknown>(`fixture.sides([${left},${right}])`);
                        await view.evaluate<unknown>(frame);
                        const gap = layout === 'roomy' ? 8 : 0;
                        expect(await view.evaluate<number>('document.querySelector(".ade-split-view").clientWidth')).toBe(
                            800 - (left ? 120 + gap : 0) - (right ? 100 + gap : 0)
                        );
                        expect(
                            await view.evaluate<string[]>(
                                '(() => {const css=getComputedStyle(document.querySelector(".ade-workspace-toolbar"));return [css.borderBottomLeftRadius,css.borderBottomRightRadius]})()'
                            )
                        ).toEqual([`${left ? gap : 0}px`, `${right ? gap : 0}px`]);
                    }
                }
                const divider = 'document.querySelector(".ade-split-divider[aria-orientation=vertical]")';
                expect(await view.evaluate<unknown>(`${divider}.getBoundingClientRect().width`)).toBe(layout === 'roomy' ? 8 : 1);
                await view.evaluate<unknown>(`${divider}.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
                await view.evaluate<unknown>(frame);
                expect(await view.evaluate<unknown>('fixture.store.getState().layout.columns.map(column=>column.size)')).toEqual([0.25, 0.25, 0.5]);
                await view.evaluate<unknown>(`${divider}.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,altKey:true}))`);
                await view.evaluate<unknown>(frame);
                expect(await view.evaluate<unknown>('fixture.store.getState().layout.columns.map(column=>column.size)')).toEqual([1 / 3, 1 / 3, 1 / 3]);
                await view.evaluate<unknown>(`fixture.store.setState({layout:{columns:[
                    {size:0.4,cells:[{size:0.2,viewId:'a'},{size:0.8,viewId:'b'}]},
                    {size:0.6,cells:[{size:0.7,viewId:'c'},{size:0.3,viewId:'d'}]}
                ],focus:{column:0,cell:0}}})`);
                await view.evaluate<unknown>(frame);
                await view.evaluate<unknown>(
                    `document.querySelector('.ade-split-divider[aria-orientation=horizontal]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,altKey:true}))`
                );
                await view.evaluate<unknown>(frame);
                expect(await view.evaluate<unknown>('fixture.store.getState().layout.columns.map(column=>column.cells.map(cell=>cell.size))')).toEqual([
                    [0.5, 0.5],
                    [0.5, 0.5]
                ]);
                expect(await view.evaluate<unknown>('fixture.store.getState().layout.columns.map(column=>column.size)')).toEqual([0.4, 0.6]);
                await view.evaluate<unknown>('fixture.reset()');
                await view.evaluate<unknown>(frame);
                const point = await view.evaluate<{ x: number; y: number; delta: number }>(
                    `(() => {const rect=${divider}.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2,delta:0.05*(800-2*rect.width)-7}})()`
                );
                await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
                await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + point.delta, y: point.y, button: 'left', buttons: 1 });
                await view.cdp('Input.dispatchMouseEvent', {
                    type: 'mouseReleased',
                    x: point.x + point.delta,
                    y: point.y,
                    button: 'left',
                    buttons: 0,
                    clickCount: 1
                });
                await view.evaluate<unknown>(frame);
                expect(await view.evaluate<unknown>('fixture.store.getState().layout.columns.map(column=>column.size)')).toEqual([0.25, 0.25, 0.5]);
            }
            await view.evaluate<unknown>('fixture.reset()');
            await view.evaluate<unknown>(frame);
            const handle = await view.evaluate<{ x: number; y: number }>(
                '(() => { const rect=document.querySelector(".ade-split-divider[aria-orientation=vertical]").getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()'
            );
            await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', buttons: 1, clickCount: 1 });
            await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x + 5, y: handle.y, button: 'left', buttons: 1 });
            await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x + 20, y: handle.y, button: 'left', buttons: 1, modifiers: 1 });
            await view.evaluate<unknown>(frame);
            const mirrored = await view.evaluate<number[]>('fixture.store.getState().layout.columns.map(column=>column.size)');
            expect(mirrored[0]).toBeCloseTo(0.2 + 20 / 784);
            expect(mirrored[1]).toBeCloseTo(0.3 - 40 / 784);
            expect(mirrored[2]).toBeCloseTo(0.5 + 20 / 784);
            await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x + 20, y: handle.y, button: 'left', buttons: 1 });
            await view.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle.x + 20, y: handle.y, button: 'left', buttons: 0, clickCount: 1 });
            await view.evaluate<unknown>(frame);
            expect(await view.evaluate<unknown>('fixture.store.getState().layout.columns[2].size')).toBe(0.5);
            await view.evaluate<unknown>('fixture.store.getState().activateTab("d")');
            await view.evaluate<unknown>(frame);
            expect(await view.evaluate<unknown>('document.querySelector("[data-split-view-id=a]").hidden')).toBe(true);
            expect(await view.evaluate<unknown>('fixture.cellElement("a")===null && fixture.cellElement("d")!==null')).toBe(true);
            await view.evaluate<unknown>('(() => {fixture.store.getState().activateTab("a");fixture.store.getState().toggleMaximized()})()');
            await view.evaluate<unknown>(frame);
            expect(await view.evaluate<unknown>('document.querySelectorAll(".ade-split-content:not([hidden])").length')).toBe(1);
            await view.evaluate<unknown>('fixture.store.getState().toggleMaximized()');
            await view.evaluate<unknown>(frame);
            // A tab from a group exchanges with the active view at the center of another pane.
            await view.evaluate<unknown>(`(() => {
                const source=document.querySelector('[data-split-view-id=a] [data-tab-id=a] [role=tab]');
                const transfer=new DataTransfer();
                source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));
                const target=document.querySelector('[data-split-view-id=b] [data-split-cell]');const rect=target.getBoundingClientRect();
                for(const type of ['dragover','drop'])target.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2}));
                source.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:transfer}));
            })()`);
            await view.evaluate<unknown>(frame);
            expect(await view.evaluate<unknown>('fixture.store.getState().layout.columns.map(column=>column.cells[0].viewId)')).toEqual(['b', 'a', 'c']);
            expect(
                await view.evaluate<unknown>(
                    'document.querySelector("[data-split-view-id=a]")===savedHost && document.querySelector("[data-split-view-id=a] [data-canvas-surface]")===savedCanvas'
                )
            ).toBe(true);
            expect(await view.evaluate<unknown>('fixture.store.getState().exportLocal().layout.columns[0].cells[0].tabs')).toEqual(['b', 'd']);
            expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
        }
    );
}, 30000);
