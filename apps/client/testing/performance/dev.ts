import { realpathSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Plugin } from 'vite';
import { measureDialogs } from './bench';

const client = join(import.meta.dir, '../..');
const directory = await mkdtemp(join(tmpdir(), 'ruimte-dev-bench-'));
const bundled = process.env.BENCH_BUNDLED === '1';
const eager = process.env.BENCH_EAGER === '1';
const screens = process.env.BENCH_SCREENS === '1';
const runs = Number(process.env.BENCH_RUNS ?? 1);
const samples = [];
const marker = `<head><script>
    performance.setResourceTimingBufferSize(20000);
    Object.defineProperty(navigator,'connection',{value:{saveData:true}});
    window.benchErrors=[];
    addEventListener('error',e=>window.benchErrors.push(e.message));
    addEventListener('unhandledrejection',e=>window.benchErrors.push(String(e.reason)));
    window.benchReady=new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('Dev start screen did not appear: '+window.benchErrors.join('; '))),30000);
        new MutationObserver((_,observer)=>{
            if(document.querySelector('#root button')){
                clearTimeout(timeout);observer.disconnect();
                const resources=performance.getEntriesByType('resource');
                requestAnimationFrame(()=>resolve({readyMs:performance.now(),requests:resources.length,bytes:resources.reduce((sum,row)=>sum+row.decodedBodySize,0),errors:window.benchErrors}));
            }
        }).observe(document.documentElement,{childList:true,subtree:true});
    });
</script>`;
const readiness: Plugin = {
    name: 'benchmark-readiness',
    transformIndexHtml: { order: 'pre', handler: (html) => html.replace('<head>', marker) },
    transform(code, id) {
        if (process.env.BENCH_FEATURE_SMOKE === '1' && id === join(client, 'src/main.tsx')) {
            return `${code}
                window.benchFeature=()=>import('/testing/editor-label-probe.ts').then(probe=>probe.probeEditorLabels());
                window.benchWorker=async()=>{
                    const {createSnippetTransformWorker}=await import('/src/language/snippet-transform-worker.ts');
                    const worker=createSnippetTransformWorker();
                    try { return await new Promise((resolve,reject)=>{
                        const timeout=setTimeout(()=>reject(new Error('Snippet worker timed out')),10000);
                        worker.onerror=event=>{clearTimeout(timeout);reject(new Error(event.message))};
                        worker.onmessage=({data})=>{
                            if(data.type==='ready') worker.postMessage({type:'transform',id:1,jobs:[]});
                            else {clearTimeout(timeout);data.type==='transformed'?resolve(data):reject(new Error(JSON.stringify(data)))};
                        };
                    }); } finally { worker.terminate(); }
                };
            `;
        }
        return null;
    }
};

async function probeHmr(
    view: InstanceType<typeof Bun.WebView>,
    path: string,
    change: (source: string) => string,
    selector: string,
    css = false
): Promise<number> {
    const source = await readFile(path, 'utf8');
    const updated = change(source);
    if (source === updated) {
        throw new Error(`Could not find HMR target in ${path}`);
    }
    const identity = await view.evaluate('window.benchIdentity=crypto.randomUUID()');
    await view.evaluate(`(()=>{window.benchHmr=new Promise((resolve,reject)=>{
        const started=performance.now();const timeout=setTimeout(()=>reject(new Error('HMR did not update '+${JSON.stringify(selector)})),15000);
        const observer=new MutationObserver(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(el&&${css ? "getComputedStyle(el).outlineOffset==='7px'" : 'true'}){observer.disconnect();clearTimeout(timeout);requestAnimationFrame(()=>resolve(performance.now()-started));}});
        observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,characterData:true});
    });})()`);
    try {
        await writeFile(path, updated);
        const elapsed = await view.evaluate<number>('window.benchHmr');
        if (identity !== (await view.evaluate('window.benchIdentity'))) {
            throw new Error('HMR reloaded the page');
        }
        return elapsed;
    } finally {
        await writeFile(path, source);
    }
}

try {
    for (let run = 0; run < runs; run++) {
        const started = performance.now();
        const server = await createServer({
            root: client,
            configFile: join(client, 'vite.config.ts'),
            cacheDir: join(directory, `cache-${run}`),
            experimental: { bundledDev: bundled },
            build: { rolldownOptions: { experimental: { devMode: { lazy: !eager } } } },
            server: { host: '127.0.0.1', port: 0, strictPort: false, open: false, proxy: { '/ws': { target: 'ws://127.0.0.1:1', ws: true } } },
            plugins: [readiness],
            logLevel: 'error'
        });
        let view: InstanceType<typeof Bun.WebView> | null = null;
        try {
            await server.listen();
            const serverMs = performance.now() - started;
            const address = server.httpServer!.address();
            if (address === null || typeof address === 'string') {
                throw new Error('No dev server address');
            }
            const url = `http://127.0.0.1:${address.port}`;
            view = new Bun.WebView({ backend: { type: 'chrome', url: false }, headless: true, dataStore: { directory: join(directory, `profile-${run}`) } });
            const pages = [];
            let dialogs: Record<string, number> = {};
            for (let reload = 0; reload < 3; reload++) {
                const navigationStarted = performance.now();
                await view.navigate(`${url}/?bench=${reload}`);
                let page: { readyMs: number; requests: number; bytes: number; errors: string[] } | null = null;
                // Bundled dev initially serves a bootstrap page that reloads when its first bundle is ready.
                for (let attempt = 0; attempt < 1200 && page === null; attempt++) {
                    page = await view.evaluate('window.benchReady ?? null');
                    if (page === null) {
                        await Bun.sleep(25);
                    }
                }
                if (page === null) {
                    throw new Error(`Dev document did not run the readiness probe: ${await view.evaluate('document.body.textContent.slice(0,1000)')}`);
                }
                if (page.errors.length > 0) {
                    throw new Error(page.errors.join('\n'));
                }
                pages.push({ ...page, navigationMs: performance.now() - navigationStarted });
                if (screens && reload === 0) {
                    dialogs = await measureDialogs(view);
                }
            }
            const hmrMs =
                process.env.BENCH_HMR === '0'
                    ? null
                    : await probeHmr(
                          view,
                          join(client, 'src/shell/StartScreen.tsx'),
                          (source) =>
                              source.replace(
                                  '<div className="mx-auto flex min-h-full w-full max-w-4xl',
                                  '<div data-bench-hmr="1" className="mx-auto flex min-h-full w-full max-w-4xl'
                              ),
                          '[data-bench-hmr="1"]'
                      );
            let linkedHmrMs: number | null = null;
            if (process.env.BENCH_LINKED_HMR === '1') {
                const path = realpathSync(join(client, 'node_modules/@adecore/ui/src/Button.tsx'));
                if (path.includes('/node_modules/')) {
                    throw new Error('Linked HMR requires a local ADE CORE checkout');
                }
                linkedHmrMs = await probeHmr(
                    view,
                    path,
                    (source) =>
                        source
                            .replace('<button ref={ref}', '<button data-bench-linked-hmr="1" ref={ref}')
                            .replace(
                                'clsx(buttonClass(variant, size, shape), className)',
                                "clsx(buttonClass(variant, size, shape), 'outline-offset-[7px]', className)"
                            ),
                    '[data-bench-linked-hmr="1"]',
                    true
                );
            }
            let editor: unknown = null;
            let worker: unknown = null;
            if (process.env.BENCH_FEATURE_SMOKE === '1') {
                editor = await view.evaluate(`window.benchFeature().then(result=>{
                    if(!result.sameEditor||!result.sameWords||result.composer.text!=='Write a reply.'||!result.english||!result.dutch||result.english===result.dutch) throw new Error('Editor probe failed: '+JSON.stringify(result));
                    return result;
                })`);
                worker = await view.evaluate('window.benchWorker()');
            }
            const errors = await view.evaluate<string[]>('window.benchErrors');
            if (errors.length > 0) {
                throw new Error(errors.join('\n'));
            }
            samples.push({ serverMs, pages, dialogs, hmrMs, linkedHmrMs, editor, worker });
        } finally {
            view?.close();
            await server.close();
        }
    }
    console.log(JSON.stringify({ benchmark: 'vite-dev', bundled, eager, runs, samples }, null, 2));
} finally {
    await rm(directory, { recursive: true, force: true });
}
