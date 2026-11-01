import { extname, join } from 'node:path';

export async function measureRestore(options: {
    daemonUrl: string;
    secret: string;
    projectId: string;
    profile: string;
    settings?: Record<string, unknown>;
    assetDelayMs?: number;
    inject?: string;
    probe?: (view: Bun.WebView) => Promise<unknown>;
}) {
    const root = process.env.BENCH_CLIENT_DIST ?? join(import.meta.dir, '../../dist');
    const gateMs = Number(process.env.BENCH_SECRET_DELAY ?? 0);
    const waitBeforeWindow = process.env.BENCH_WAIT_BEFORE_WINDOW === '1';
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
            const path = new URL(request.url).pathname;
            if (path.endsWith('.js') && options.assetDelayMs) {
                await Bun.sleep(options.assetDelayMs);
            }
            const file = Bun.file(join(root, path === '/' ? 'index.html' : path));
            if (!(await file.exists())) {
                return new Response(null, { status: 404 });
            }
            if (path === '/') {
                return new Response(
                    (await file.text()).replace(
                        '<head>',
                        `<head><script>
                    performance.setResourceTimingBufferSize(10000);
                    Object.defineProperty(navigator,'connection',{value:{saveData:true}});
                    localStorage.setItem('ruimte.settings',JSON.stringify({onboardingSeen:true,onboardingIntroSeen:true,...${JSON.stringify(options.settings ?? {})}}));
                    window.ruimteDesktop={platform:'darwin',daemonUrl:${JSON.stringify(options.daemonUrl)},
                        pickFolder:async()=>null,openExternal:async()=>{},openGuestDevTools:()=>{},isFullscreen:async()=>false,onFullscreen:()=>()=>{},
                        localSecret:()=>new Promise(resolve=>setTimeout(()=>resolve(${JSON.stringify(options.secret)}),${waitBeforeWindow ? 0 : gateMs})),claimWindow:async()=>true
                    };
                    window.benchErrors=[];
                    window.benchRequests=[];
                    addEventListener('error',event=>window.benchErrors.push(event.message));
                    addEventListener('unhandledrejection',event=>window.benchErrors.push(String(event.reason)));
                    const NativeSocket=window.WebSocket;
                    window.WebSocket=class extends NativeSocket {
                        constructor(...args){super(...args);this.benchSent=new Map();this.addEventListener('message',event=>{
                            if(typeof event.data!=='string')return;
                            const reply=JSON.parse(event.data);const sent=this.benchSent.get(reply.id);
                            if(sent){window.benchRequests.push({id:reply.id,type:sent.type,start:sent.at,end:performance.now()});this.benchSent.delete(reply.id)}
                        });}
                        send(raw){if(typeof raw==='string'){const request=JSON.parse(raw);if(request.id)this.benchSent.set(request.id,{type:request.type,at:performance.now()})}super.send(raw);}
                    };
                    ${options.inject ?? ''}
                    window.benchReady=new Promise((resolve,reject)=>{
                        let statusShown=false;
                        const timer=setTimeout(()=>reject(new Error('Workspace did not open: '+document.body.innerText.slice(0,400)+'; '+window.benchErrors.join('; '))),15000);
                        const observer=new MutationObserver(()=>{
                            if(document.querySelector('[role=status].absolute.inset-0.z-10'))statusShown=true;
                            if(document.querySelector('main.workspace')){
                                observer.disconnect();clearTimeout(timer);
                                requestAnimationFrame(()=>{const resources=performance.getEntriesByType('resource').filter(row=>row.name.endsWith('.js'));
                                    resolve({readyMs:performance.now(),statusShown,requests:window.benchRequests.filter(row=>['endpoint.info','project.open','project.list'].includes(row.type)),
                                        jsRequests:resources.length,jsBytes:resources.reduce((sum,row)=>sum+row.decodedBodySize,0),
                                        workspace:resources.filter(row=>/[Ww]orkspace/.test(row.name)).map(row=>({name:row.name.split('/').at(-1),start:row.startTime,end:row.responseEnd})),errors:window.benchErrors});});
                            }
                        });observer.observe(document.documentElement,{subtree:true,childList:true});
                    });
                </script>`
                    ),
                    { headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } }
                );
            }
            const type = extname(path) === '.js' ? 'text/javascript' : extname(path) === '.css' ? 'text/css' : file.type;
            return new Response(file, { headers: { 'content-type': type, 'cache-control': 'no-store' } });
        }
    });
    const samples = [];
    try {
        for (let run = 0; run < Number(process.env.BENCH_RESTORE_RUNS ?? 5); run++) {
            const view = new Bun.WebView({
                backend: { type: 'chrome', url: false },
                headless: true,
                dataStore: { directory: join(options.profile, String(run)) }
            });
            try {
                // Chrome's profile is per process, so a new directory alone does not isolate this sample.
                await view.navigate('about:blank');
                await view.cdp('Storage.clearDataForOrigin', { origin: `http://127.0.0.1:${server.port}`, storageTypes: 'all' });
                const waiting = performance.now();
                if (waitBeforeWindow) {
                    await Bun.sleep(gateMs);
                }
                const launchWaitMs = performance.now() - waiting;
                await view.navigate(`http://127.0.0.1:${server.port}/?project=${encodeURIComponent(`local:${options.projectId}`)}`);
                const sample = await view.evaluate<{ readyMs: number; statusShown: boolean; errors: string[] }>('window.benchReady');
                if (sample.errors.length > 0) {
                    throw new Error(sample.errors.join('\n'));
                }
                const probe = options.probe ? await options.probe(view) : undefined;
                samples.push({ ...sample, launchWaitMs, totalMs: launchWaitMs + sample.readyMs, ...(probe === undefined ? {} : { probe }) });
            } finally {
                view.close();
            }
        }
    } finally {
        await server.stop(true);
    }
    return { gateMs, waitBeforeWindow, samples };
}
