import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { frame, withBrowserFixture } from '../../testing/browser-fixture';

const HOST_BOX = '(() => {const rect=document.querySelector(".browser-host").getBoundingClientRect(); return [rect.x,rect.y,rect.width,rect.height];})()';

test('parked browser pages leave the node border visible at every canvas zoom', async () => {
    const styles = await readFile(join(import.meta.dir, '../styles.css'), 'utf8');
    const hostStyles = styles.match(/\.browser-host(?:\[data-square\])?\s*\{[^}]+\}/g)!.join('\n');
    await withBrowserFixture(
        `
        import { WebviewParking } from ${JSON.stringify(join(import.meta.dir, 'WebviewParking.tsx'))};
        import { browserRegistry, useBrowser } from ${JSON.stringify(join(import.meta.dir, 'registry.ts'))};
        import { defaultCanvases } from ${JSON.stringify(join(import.meta.dir, '../state/canvas.ts'))};
        import { useDocument } from ${JSON.stringify(join(import.meta.dir, '../state/document.ts'))};
        import { registerCell } from ${JSON.stringify(join(import.meta.dir, '../shell/cell-rects.ts'))};
        window.ruimteDesktop={platform:'linux'};
        const guest=document.createElement('div');
        guest.dataset.guest='';
        guest.send=()=>{};
        browserRegistry.get=()=>guest;
        useBrowser.getState().patch('local:browser',{url:'https://example.com'});
        useDocument.setState({layout:{columns:[{size:1,cells:[{size:1,viewId:'main'}]}],focus:{column:0,cell:0}}});
        const canvas=defaultCanvases.of('main');
        canvas.setState({viewId:'main',nodes:{browser:{id:'browser',kind:'browser',title:'Browser',x:40,y:40,w:400,h:400}},order:['browser'],camera:{x:12,y:16,zoom:1}});
        window.fixture={canvas,guest,document:useDocument,registerCell};
        createRoot(document.getElementById('root')).render(<UIProvider i18n={i18next}>
            <div ref={element=>registerCell('main',element)} style={{position:'absolute',inset:0}}/>
            <WebviewParking/>
        </UIProvider>);
        `,
        `${hostStyles}:root{--radius-xl:12px}*{box-sizing:border-box}.absolute{position:absolute}.inset-0{inset:0}.top-0{top:0}.left-0{left:0}.origin-top-left{transform-origin:top left}.overflow-hidden{overflow:hidden}.pointer-events-none{pointer-events:none}`,
        async (view) => {
            for (const zoom of [1, 0.5, 1.5]) {
                await view.evaluate(`fixture.canvas.setState({camera:{x:12,y:16,zoom:${zoom}}})`);
                await view.evaluate(frame);
                const page = await view.evaluate<{ x: number; y: number; width: number; height: number }>(
                    'document.querySelector(".browser-host").getBoundingClientRect().toJSON()'
                );
                expect(page.x).toBe(12 + 41 * zoom);
                expect(page.y).toBe(16 + 117 * zoom);
                expect(page.width).toBe(398 * zoom);
                expect(page.height).toBe(322 * zoom);
            }
            expect(await view.evaluate<string>('getComputedStyle(document.querySelector(".browser-host")).borderBottomLeftRadius')).toBe('11px');
            await view.evaluate(`fixture.canvas.setState({camera:{x:12,y:16,zoom:1},bodyFocusId:'browser',nodes:{
                ...fixture.canvas.getState().nodes,
                cover:{id:'cover',kind:'note',title:'Cover',x:140,y:180,w:80,h:80}
            },order:['browser','cover']})`);
            await view.evaluate(frame);
            expect(await view.evaluate<boolean>('document.elementFromPoint(152.5,236)?.closest(".browser-host") === null')).toBe(true);
            expect(await view.evaluate<boolean>('!!document.elementFromPoint(151.5,236)?.closest(".browser-host")')).toBe(true);

            await view.evaluate('fixture.canvas.setState({maximizedId:"browser"})');
            await view.evaluate(frame);
            expect(await view.evaluate<number[]>(HOST_BOX)).toEqual([0, 76, 800, 524]);
            expect(await view.evaluate<string>('getComputedStyle(document.querySelector(".browser-host")).borderBottomLeftRadius')).toBe('0px');

            await view.evaluate('fixture.canvas.setState({maximizedId:null})');
            await view.evaluate(frame);
            expect(await view.evaluate<string>('getComputedStyle(document.querySelector(".browser-host")).borderBottomLeftRadius')).toBe('11px');

            await view.evaluate('fixture.document.setState({layout:{columns:[{size:1,cells:[{size:1,viewId:"browser"}]}],focus:{column:0,cell:0}}})');
            await view.evaluate('fixture.registerCell("browser",document.querySelector("#root > div"))');
            await view.evaluate(frame);
            expect(await view.evaluate<number[]>(HOST_BOX)).toEqual([0, 0, 800, 600]);
            expect(await view.evaluate<string>('getComputedStyle(document.querySelector(".browser-host")).borderBottomLeftRadius')).toBe('0px');
            expect(await view.evaluate<boolean>('fixture.guest.parentElement === document.querySelector(".browser-host")')).toBe(true);
            expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
        }
    );
}, 15000);

const VISIBILITY = 'getComputedStyle(document.querySelector(".browser-host")).visibility';
const pause = (ms: number): string => `new Promise(resolve => setTimeout(resolve, ${ms}))`;

test('a page past the render distance is hidden in its host after one picture and comes back at once, never leaving its parent', async () => {
    await withBrowserFixture(
        `
        import { WebviewParking } from ${JSON.stringify(join(import.meta.dir, 'WebviewParking.tsx'))};
        import { browserRegistry, useBrowser } from ${JSON.stringify(join(import.meta.dir, 'registry.ts'))};
        import { usePageSnapshots } from ${JSON.stringify(join(import.meta.dir, 'page-snapshots.ts'))};
        import { defaultCanvases } from ${JSON.stringify(join(import.meta.dir, '../state/canvas.ts'))};
        import { useDocument } from ${JSON.stringify(join(import.meta.dir, '../state/document.ts'))};
        import { useSettings } from ${JSON.stringify(join(import.meta.dir, '../state/settings.ts'))};
        import { registerCell } from ${JSON.stringify(join(import.meta.dir, '../shell/cell-rects.ts'))};
        const picture=new OffscreenCanvas(40,30);
        picture.getContext('2d').fillRect(0,0,40,30);
        const png=new Uint8Array(await (await picture.convertToBlob({type:'image/png'})).arrayBuffer());
        window.captures=0;
        window.passes=0;
        window.ruimteDesktop={platform:'linux',capturePage:async()=>{window.captures++;return png;}};
        const guest=document.createElement('div');
        guest.dataset.guest='';
        guest.send=()=>{};
        guest.getWebContentsId=()=>1;
        browserRegistry.get=()=>guest;
        browserRegistry.elements.set('local:browser',guest);
        useBrowser.getState().patch('local:browser',{url:'https://example.com'});
        useDocument.setState({layout:{columns:[{size:1,cells:[{size:1,viewId:'main'}]}],focus:{column:0,cell:0}}});
        const canvas=defaultCanvases.of('main');
        canvas.setState({viewId:'main',nodes:{browser:{id:'browser',kind:'browser',title:'Browser',x:40,y:40,w:400,h:400}},order:['browser'],camera:{x:12,y:16,zoom:1}});
        window.fixture={canvas,guest,snapshots:usePageSnapshots,settings:useSettings};
        createRoot(document.getElementById('root')).render(<UIProvider i18n={i18next}>
            <div ref={element=>{
                // Every pass of the layer measures the cell once, which is what counts the passes.
                if(element&&!element.counted){const measure=element.getBoundingClientRect.bind(element);element.getBoundingClientRect=()=>{window.passes++;return measure();};element.counted=true;}
                registerCell('main',element);
            }} style={{position:'absolute',inset:0}}/>
            <WebviewParking/>
        </UIProvider>);
        `,
        `*{box-sizing:border-box}.absolute{position:absolute}.inset-0{inset:0}.top-0{top:0}.left-0{left:0}.origin-top-left{transform-origin:top left}.overflow-hidden{overflow:hidden}.pointer-events-none{pointer-events:none}`,
        async (view) => {
            const host = 'document.querySelector(".browser-host")';
            await view.evaluate(frame);
            expect(await view.evaluate<string>(VISIBILITY)).toBe('visible');

            // Past the line the page waits out the pause, is photographed once while still drawn, and goes.
            await view.evaluate('fixture.canvas.setState({camera:{x:12,y:16,zoom:0.3}})');
            await view.evaluate(frame);
            expect(await view.evaluate<string>(VISIBILITY)).toBe('visible');
            await view.evaluate(pause(800));
            await view.evaluate(frame);
            expect(await view.evaluate<string>(VISIBILITY)).toBe('hidden');
            expect(await view.evaluate<boolean>('fixture.snapshots.getState().byKey["local:browser"].far')).toBe(true);
            expect(await view.evaluate<number>('window.captures')).toBe(1);
            expect(await view.evaluate<boolean>('fixture.snapshots.getState().byKey["local:browser"].imageUrl.startsWith("blob:")')).toBe(true);

            // Back on the line it is drawn again in the same frame, in the same host.
            await view.evaluate('fixture.canvas.setState({camera:{x:12,y:16,zoom:0.4}})');
            await view.evaluate(frame);
            expect(await view.evaluate<string>(VISIBILITY)).toBe('visible');

            // The page with the keyboard stays live past the line, and once the pause is over the layer rests.
            await view.evaluate('fixture.canvas.setState({camera:{x:12,y:16,zoom:0.3},bodyFocusId:"browser"})');
            await view.evaluate(pause(800));
            await view.evaluate(frame);
            expect(await view.evaluate<string>(VISIBILITY)).toBe('visible');
            const passes = await view.evaluate<number>('window.passes');
            await view.evaluate(pause(300));
            expect(await view.evaluate<number>('window.passes')).toBe(passes);

            // Folded, the active page is hidden all the same: the distance only ever adds a reason to hide.
            await view.evaluate('fixture.canvas.setState({nodes:{browser:{...fixture.canvas.getState().nodes.browser,collapsed:true}}})');
            await view.evaluate(frame);
            expect(await view.evaluate<string>(VISIBILITY)).toBe('hidden');
            await view.evaluate('fixture.canvas.setState({nodes:{browser:{...fixture.canvas.getState().nodes.browser,collapsed:false}}})');
            await view.evaluate(frame);
            expect(await view.evaluate<string>(VISIBILITY)).toBe('visible');

            // Far draws it at 0.3, and a change of the setting needs no move of the camera.
            await view.evaluate('fixture.canvas.setState({bodyFocusId:null})');
            await view.evaluate('fixture.settings.setState({canvasRenderDistance:"far"})');
            await view.evaluate(pause(800));
            await view.evaluate(frame);
            expect(await view.evaluate<string>(VISIBILITY)).toBe('visible');
            await view.evaluate('fixture.settings.setState({canvasRenderDistance:"standard"})');
            await view.evaluate(pause(800));
            await view.evaluate(frame);
            expect(await view.evaluate<string>(VISIBILITY)).toBe('hidden');

            // Maximized, a page is drawn whatever the zoom.
            await view.evaluate('fixture.canvas.setState({maximizedId:"browser"})');
            await view.evaluate(frame);
            expect(await view.evaluate<string>(VISIBILITY)).toBe('visible');

            expect(await view.evaluate<boolean>(`fixture.guest.parentElement === ${host}`)).toBe(true);
            expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
        }
    );
}, 30000);

test('two canvases side by side each hold their own pages to their own camera', async () => {
    await withBrowserFixture(
        `
        import { WebviewParking } from ${JSON.stringify(join(import.meta.dir, 'WebviewParking.tsx'))};
        import { browserRegistry, useBrowser } from ${JSON.stringify(join(import.meta.dir, 'registry.ts'))};
        import { defaultCanvases } from ${JSON.stringify(join(import.meta.dir, '../state/canvas.ts'))};
        import { useDocument } from ${JSON.stringify(join(import.meta.dir, '../state/document.ts'))};
        import { registerCell } from ${JSON.stringify(join(import.meta.dir, '../shell/cell-rects.ts'))};
        window.ruimteDesktop={platform:'linux',capturePage:async()=>null};
        const guests={};
        for(const key of ['local:near','local:far']){
            const guest=document.createElement('div');
            guest.dataset.guest=key;
            guest.send=()=>{};
            guest.getWebContentsId=()=>1;
            guests[key]=guest;
            browserRegistry.elements.set(key,guest);
            useBrowser.getState().patch(key,{url:'https://example.com'});
        }
        browserRegistry.get=(key)=>guests[key];
        useDocument.setState({layout:{columns:[{size:1,cells:[{size:1,viewId:'left'}]},{size:1,cells:[{size:1,viewId:'right'}]}],focus:{column:0,cell:0}}});
        defaultCanvases.of('left').setState({viewId:'left',nodes:{near:{id:'near',kind:'browser',title:'Near',x:0,y:0,w:300,h:300}},order:['near'],camera:{x:0,y:0,zoom:1}});
        defaultCanvases.of('right').setState({viewId:'right',nodes:{far:{id:'far',kind:'browser',title:'Far',x:0,y:0,w:300,h:300}},order:['far'],camera:{x:0,y:0,zoom:0.3}});
        createRoot(document.getElementById('root')).render(<UIProvider i18n={i18next}>
            <div ref={element=>registerCell('left',element)} style={{position:'absolute',left:0,top:0,width:400,height:600}}/>
            <div ref={element=>registerCell('right',element)} style={{position:'absolute',left:400,top:0,width:400,height:600}}/>
            <WebviewParking/>
        </UIProvider>);
        `,
        `*{box-sizing:border-box}.absolute{position:absolute}.inset-0{inset:0}.top-0{top:0}.left-0{left:0}.origin-top-left{transform-origin:top left}.overflow-hidden{overflow:hidden}.pointer-events-none{pointer-events:none}`,
        async (view) => {
            const visibility = (key: string): Promise<string> =>
                view.evaluate<string>(`getComputedStyle(document.querySelector('[data-guest="${key}"]').parentElement).visibility`);
            await view.evaluate(pause(800));
            await view.evaluate(frame);
            expect(await visibility('local:near')).toBe('visible');
            expect(await visibility('local:far')).toBe('hidden');
            expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
        }
    );
}, 30000);
