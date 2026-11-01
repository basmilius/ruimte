import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { measureDialogs } from './bench';

const root = process.env.BENCH_CLIENT_DIST ?? join(import.meta.dir, '../../dist');
const runs = Number(process.env.BENCH_RUNS ?? 9);
const language = process.env.BENCH_LANGUAGE ?? 'en';
const latency = Number(process.env.BENCH_LATENCY ?? 0);
const screens = process.env.BENCH_SCREENS === '1';
const cpuRate = Number(process.env.BENCH_CPU_RATE ?? 1);
if (!Number.isFinite(cpuRate) || cpuRate < 1) {
    throw new Error('BENCH_CPU_RATE must be at least 1');
}
const profile = await mkdtemp(join(tmpdir(), 'ruimte-startup-bench-'));
const samples: unknown[] = [];
const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };
const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/ws') {
            return new Response(null, { status: 503 });
        }
        const file = Bun.file(join(root, path === '/' ? 'index.html' : path));
        if (!(await file.exists())) {
            return new Response(null, { status: 404 });
        }
        if (path === '/') {
            const html = await file.text();
            return new Response(
                html.replace(
                    '<head>',
                    `<head><script>
                    performance.setResourceTimingBufferSize(10000);
                    Object.defineProperty(navigator,'languages',{value:[${JSON.stringify(language)}]});
                    ${screens ? "Object.defineProperty(navigator,'connection',{value:{saveData:true}});" : ''}
                    window.benchErrors=[];
                    addEventListener('error',e=>window.benchErrors.push(e.message));
                    addEventListener('unhandledrejection',e=>window.benchErrors.push(String(e.reason)));
                    window.benchReady=new Promise((resolve,reject)=>{
                        const timeout=setTimeout(()=>reject(new Error('Start screen did not appear')),10000);
                        new MutationObserver((_,observer)=>{
                        if(document.querySelector('#root button')){
                            clearTimeout(timeout);
                            observer.disconnect();
                            const resources=performance.getEntriesByType('resource').filter(r=>r.name.endsWith('.js')).map(r=>({name:r.name,bytes:r.decodedBodySize}));
                            requestAnimationFrame(()=>resolve({ready:performance.now(),resources,language:document.documentElement.lang,errors:window.benchErrors}));
                        }
                    }).observe(document.documentElement,{childList:true,subtree:true});});
                </script>`
                ),
                { headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } }
            );
        }
        if (latency > 0) {
            await Bun.sleep(latency);
        }
        return new Response(file, { headers: { 'content-type': types[extname(path)] ?? file.type, 'cache-control': 'no-store' } });
    }
});
try {
    for (let i = 0; i < runs; i++) {
        const view = new Bun.WebView({ backend: { type: 'chrome', url: false }, headless: true, dataStore: { directory: join(profile, String(i)) } });
        try {
            // Every sample starts without the client state retained by Chrome's shared profile.
            await view.navigate('about:blank');
            await view.cdp('Storage.clearDataForOrigin', { origin: `http://127.0.0.1:${server.port}`, storageTypes: 'all' });
            if (cpuRate !== 1) {
                await view.navigate('about:blank');
                await view.cdp('Emulation.setCPUThrottlingRate', { rate: cpuRate });
            }
            await view.navigate(`http://127.0.0.1:${server.port}`);
            await view.resize(1200, 800);
            const sample = await view.evaluate<{ ready: number; resources: { name: string; bytes: number }[]; language: string; errors: string[] }>(
                'window.benchReady'
            );
            if (sample.errors.length > 0) {
                throw new Error(sample.errors.join('\n'));
            }
            if (sample.language !== language) {
                throw new Error(`Expected ${language}, got ${sample.language}`);
            }
            const dialogs = screens ? await measureDialogs(view) : {};
            samples.push({
                readyMs: sample.ready,
                jsRequests: sample.resources.length,
                jsBytes: sample.resources.reduce((sum, resource) => sum + resource.bytes, 0),
                ...(screens ? { dialogs } : {})
            });
        } finally {
            view.close();
        }
    }
    console.log(JSON.stringify({ benchmark: 'cold-start-screen', runs, language, latency, cpuRate, samples }, null, 2));
} finally {
    await server.stop(true);
    await rm(profile, { recursive: true, force: true });
}
