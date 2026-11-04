import { ChatInfoSchema } from '@ruimte/contracts';
import { chatInfoOf } from '../chat-info';
import { cpuTaskMs } from './bench';
import { withProjectFixture } from './project-fixture';
import { measureRestore } from './restore';

const count = Number(process.env.BENCH_PROJECTS ?? 20);
const views = Number(process.env.BENCH_VIEWS ?? 100);
const updates = Number(process.env.BENCH_UPDATES ?? 60);
if (![count, views, updates].every((value) => Number.isInteger(value) && value > 0) || views < 2) {
    throw new Error('BENCH_PROJECTS, BENCH_VIEWS and BENCH_UPDATES must be positive integers, with at least two views');
}
const info = ChatInfoSchema.parse(chatInfoOf('view-0-1', { cwd: '/project', usage: { turns: 0, contextTokens: 0, contextWindow: null, costUsd: 0 } }));
await withProjectFixture({ projects: count, views }, async (fixture) => {
    const result = await measureRestore({
        ...fixture,
        settings: { sidebarScope: 'all-open' },
        inject: `const MeasuredSocket=window.WebSocket;window.WebSocket=class extends MeasuredSocket{constructor(...args){super(...args);window.benchSocket=this}};`,
        async probe(view) {
            await view.evaluate(`new Promise((resolve,reject)=>{
                const timer=setTimeout(()=>reject(new Error('Sidebar did not load: '+document.querySelectorAll('[data-sidebar-row]').length)),15000);
                const next=()=>{if(document.querySelectorAll('[data-sidebar-row]').length>=${count * views}){clearTimeout(timer);resolve()}else requestAnimationFrame(next)};next();
            })`);
            await view.evaluate('new Promise(resolve=>setTimeout(resolve,500))');
            await view.cdp('Performance.enable');
            const before = (await view.cdp('Performance.getMetrics')) as { metrics: { name: string; value: number }[] };
            const audit = await view.evaluate<{ rows: number; frames: number[]; errors: string[] }>(`(async()=>{
                const frames=[];
                const first=document.querySelector('[data-sidebar-row$="view:view-0-1"]');
                if(!first)throw new Error('Benchmark chat row is missing');
                const initial=first.innerHTML;
                let previous=performance.now();
                for(let index=0;index<${updates};index++){
                    const info={...${JSON.stringify(info)},status:index%2===0?'needs-you':'idle'};
                    window.benchSocket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'event',event:'chat.status',payload:{chatId:info.chatId,info}})}));
                    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
                    const now=performance.now();frames.push(now-previous);previous=now;
                    if((first.innerHTML!==initial)!==(index%2===0))throw new Error('Sidebar status did not follow update '+index);
                }
                return {rows:document.querySelectorAll('[data-sidebar-row]').length,frames,errors:window.benchErrors};
            })()`);
            const after = (await view.cdp('Performance.getMetrics')) as typeof before;
            if (audit.errors.length > 0) {
                throw new Error(audit.errors.join('\n'));
            }
            const taskMs = cpuTaskMs(before, after);
            if (taskMs > Number(process.env.BENCH_MAX_TASK_MS ?? Infinity)) {
                throw new Error(`Sidebar status updates exceeded their CPU budget: ${taskMs} ms`);
            }
            const navigation = (await view.evaluate(`(async()=>{
                const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
                const results=[];
                for(const project of ${JSON.stringify(count > 1 ? [0, 1] : [0])}){
                    const file=document.querySelector('[data-sidebar-row$="view:view-'+project+'-0"]');
                    const chat=document.querySelector('[data-sidebar-row$="view:view-'+project+'-1"]');
                    file.focus();await frame();
                    file.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));await frame();
                    const down=document.activeElement===chat;
                    chat.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));await frame();
                    const up=document.activeElement===file;
                    results.push({project,down,up,tabStops:document.querySelectorAll('[data-sidebar-row][tabindex="0"]').length});
                }
                return results;
            })()`)) as { project: number; down: boolean; up: boolean; tabStops: number }[];
            if (navigation.some((result) => !result.down || !result.up || result.tabStops !== 1)) {
                throw new Error(`Sidebar keyboard navigation changed: ${JSON.stringify(navigation)}`);
            }
            return { ...audit, taskMs, navigation };
        }
    });
    console.log(JSON.stringify({ benchmark: 'sidebar-render', count, views, updates, result }, null, 2));
});
