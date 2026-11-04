import { FsWritePayloadSchema } from '@ruimte/contracts';
import { median } from './bench';
import { withProjectFixture } from './project-fixture';
import { measureRestore } from './restore';

const content = process.env.BENCH_CONTENT ?? 'empty';
const writeDuringWatch = process.env.BENCH_WRITE_DURING_WATCH === '1';
const assetDelayMs = Number(process.env.BENCH_ASSET_DELAY ?? 0);
if (!['empty', 'file', 'tab'].includes(content) || !Number.isFinite(assetDelayMs) || assetDelayMs < 0) {
    throw new Error('BENCH_CONTENT must be empty, file or tab, and BENCH_ASSET_DELAY must be nonnegative');
}
await withProjectFixture({ projects: 1, views: content === 'file' ? 2 : 0, looseFile: content === 'tab' }, async (fixture) => {
    if (writeDuringWatch && content === 'empty') {
        throw new Error('BENCH_WRITE_DURING_WATCH requires BENCH_CONTENT=file or tab');
    }
    const write = FsWritePayloadSchema.parse({
        path: fixture.filePath,
        text: 'Sidebar benchmark.\nWritten during watch startup.\n',
        expectedMtime: 0
    });
    const writer = writeDuringWatch
        ? `
        window.benchWriteMarker='Written during watch startup. '+crypto.randomUUID();
        const WriterSocket=window.WebSocket;
        window.WebSocket=class extends WriterSocket{
            constructor(...args){super(...args);this.addEventListener('message',event=>{
                if(typeof event.data!=='string')return;
                const reply=JSON.parse(event.data);
                if(reply.id==='bench-watch-write')window.benchWriteReply=reply;
                if(reply.id==='bench-write-read'){
                    if(!reply.ok||reply.result.kind!=='text')throw new Error('Fixture metadata read failed');
                    setTimeout(()=>this.send(JSON.stringify({id:'bench-watch-write',type:'fs.write',payload:{...${JSON.stringify(write)},expectedMtime:reply.result.mtime,text:'Sidebar benchmark.\\n'+window.benchWriteMarker+'\\n'}})),50);
                }
            });}
            send(raw){super.send(raw);if(typeof raw==='string'&&JSON.parse(raw).type==='fs.watch'&&!window.benchWriteScheduled){
                window.benchWriteScheduled=true;this.send(JSON.stringify({id:'bench-write-read',type:'fs.read',payload:{path:${JSON.stringify(fixture.filePath)}}}));
            }}
        };
    `
        : '';
    const result = await measureRestore({
        ...fixture,
        assetDelayMs,
        settings: { sidebarScope: 'all-open' },
        inject:
            content !== 'empty'
                ? `${writer}window.benchContent=new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>reject(new Error('File did not open: '+document.body.innerText.slice(0,300))),15000);
            const observer=new MutationObserver(()=>{
                if(document.querySelector('.file-code')?.textContent.includes('Sidebar benchmark.')){
                    observer.disconnect();clearTimeout(timer);
                        if(${writeDuringWatch}&&!document.querySelector('.file-code').textContent.includes(window.benchWriteMarker)){reject(new Error('First file content was stale: '+JSON.stringify({reply:window.benchWriteReply,requests:window.benchRequests,text:document.querySelector('.file-code').textContent})));return;}
                        requestAnimationFrame(()=>resolve(performance.now()));
                }
            });observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
        });`
                : undefined,
        async probe(view) {
            const contentMs = content !== 'empty' ? await view.evaluate<number>('window.benchContent') : null;
            await view.evaluate('new Promise(resolve=>setTimeout(resolve,500))');
            const inventory = await view.evaluate<{
                resources: { name: string; bytes: number }[];
                errors: string[];
                requests: { id: string; type: string; start: number; end: number }[];
            }>(`({
                resources:performance.getEntriesByType('resource').filter(row=>row.name.endsWith('.js')).map(row=>({name:row.name.split('/').at(-1),bytes:row.decodedBodySize})),
                errors:window.benchErrors,requests:window.benchRequests.filter(row=>row.type.startsWith('fs.'))
            })`);
            if (inventory.errors.length > 0) {
                throw new Error(inventory.errors.join('\n'));
            }
            if (writeDuringWatch) {
                const reply = await view.evaluate<{ error?: unknown; result?: unknown } | null>('window.benchWriteReply ?? null');
                const watch = inventory.requests.find((request) => request.type === 'fs.watch');
                const write = inventory.requests.find((request) => request.type === 'fs.write');
                const read = inventory.requests.find((request) => request.type === 'fs.read' && request.id !== 'bench-write-read');
                if (!reply?.result || reply.error || !watch || !write || !read || write.start >= watch.end || write.end > read.start) {
                    throw new Error(`File freshness fixture missed the watch startup window: ${JSON.stringify({ reply, watch, write, read })}`);
                }
            }
            return { contentMs, writeDuringWatch, ...inventory };
        }
    });
    console.log(JSON.stringify({ benchmark: 'workspace-load', content, assetDelayMs, result }, null, 2));
    const measured = result.samples.map((sample) => (content !== 'empty' ? (sample.probe as { contentMs: number }).contentMs : sample.readyMs));
    if (median(measured) > Number(process.env.BENCH_MAX_LOAD_MS ?? Infinity)) {
        throw new Error('Workspace loading exceeded its timing budget');
    }
});
