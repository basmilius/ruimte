import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { withBrowserFixture, clientDirectory } from '../browser-fixture';
import { cpuTaskMs, median } from './bench';

const shared = realpathSync(join(clientDirectory, 'node_modules/@adecore/agents-react/src'));
const css = [...new Bun.Glob('assets/{index,startup}-*.css').scanSync(join(clientDirectory, 'dist'))][0]!;
const styles = await Bun.file(join(clientDirectory, 'dist', css)).text();
const count = Number(process.env.BENCH_ITEMS ?? 6000);
await withBrowserFixture(
    `
    import { Timeline } from ${JSON.stringify(join(shared, 'chat/ui/Timeline.tsx'))};
    import { ChatHostProvider } from ${JSON.stringify(join(shared, 'host.ts'))};
    import { ChatScopeContext } from ${JSON.stringify(join(shared, 'scope.ts'))};
    import { useChats } from ${JSON.stringify(join(shared, 'state/chats.ts'))};
    import { pageTimeline, scrollTimelineToEnd } from ${JSON.stringify(join(shared, 'chat/timeline-scroll.ts'))};
    const scope={id:'bench',keyOf:id=>'bench/'+id,owns:key=>key.startsWith('bench/'),transport:{status:'open',request:async()=>({}),on:()=>()=>{},subscribeStatus:()=>()=>{}},chats:{loadEarlier:async()=>{}}};
    const items=Array.from({length:${count}},(_,i)=>({id:'item-'+i,kind:'user',turnId:null,createdAt:i,text:'Message '+i+' with a short paragraph for the scrolling benchmark.'}));
    const info={chatId:'chat',provider:'claude',cwd:'/project',agentSessionId:null,selection:{model:'model'},runtimeMode:'default',status:'idle',running:false,activeTurnId:null,slashCommands:[],usage:{turns:1},background:[]};
    useChats.getState().reset(scope.keyOf('chat'),info,items);
    const started=performance.now();
    createRoot(document.getElementById('root')).render(<UIProvider i18n={i18next}><ChatHostProvider host={{}}><ChatScopeContext.Provider value={scope}><div className="chat-column h-full flex flex-col"><Timeline chatId="chat" /></div></ChatScopeContext.Provider></ChatHostProvider></UIProvider>);
    window.fixture={started,items,info,scope,useChats,pageTimeline,scrollTimelineToEnd};
    `,
    styles,
    async (view) => {
        await view.evaluate(
            'new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error("Timeline did not settle")),10000);const check=()=>{if(document.querySelector("[data-item-id]")&&document.querySelector(".chat-scroll").scrollTop>0){clearTimeout(timeout);resolve()}else requestAnimationFrame(check)};check()})'
        );
        const initial = await view.evaluate(
            '({openMs:performance.now()-fixture.started,domRows:document.querySelectorAll("[data-item-id]").length,height:document.querySelector(".chat-scroll").scrollHeight})'
        );
        await view.cdp('Performance.enable');
        await view.evaluate(
            '(()=>{const el=document.querySelector(".chat-scroll");el.scrollTo({top:el.scrollHeight*.9,behavior:"instant"});fixture.pageTimeline("chat",-1);el.scrollTo({top:el.scrollTop,behavior:"instant"})})()'
        );
        const samples = [];
        for (let run = 0; run < Number(process.env.BENCH_SCROLL_RUNS ?? 5); run++) {
            const before = (await view.cdp('Performance.getMetrics')) as { metrics: { name: string; value: number }[] };
            const scrolling = await view.evaluate<{ frames: number[]; domRows: number; errors: string[] }>(
                `(async()=>{const el=document.querySelector('.chat-scroll');const frames=[];let previous=performance.now();for(let i=0;i<90;i++){el.scrollTop=el.scrollHeight*(0.9-(i%70)/100);await new Promise(requestAnimationFrame);const now=performance.now();frames.push(now-previous);previous=now;}return {frames,domRows:document.querySelectorAll('[data-item-id]').length,errors:window.errors}})()`
            );
            if (scrolling.errors.length > 0 || scrolling.domRows > 100 || scrolling.domRows === 0) {
                throw new Error(`Invalid timeline: ${JSON.stringify(scrolling)}`);
            }
            const after = (await view.cdp('Performance.getMetrics')) as { metrics: { name: string; value: number }[] };
            samples.push({ scrolling, taskMs: cpuTaskMs(before, after) });
        }
        const anchor = await view.evaluate<{ before: { id: string; offset: number }; after: { id: string; offset: number } }>(`(async()=>{
            const el=document.querySelector('.chat-scroll');
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            const key=fixture.scope.keyOf('chat');
            const state=fixture.useChats.getState();
            fixture.useChats.setState({byKey:{...state.byKey,[key]:{...state.byKey[key],history:{start:90,cursor:'g:90'}}}});
            await new Promise(requestAnimationFrame);
            const top=el.getBoundingClientRect().top;
            const row=[...el.querySelectorAll('[data-item-id]')].find(row=>row.getBoundingClientRect().bottom>top);
            const before={id:row.dataset.itemId,offset:row.getBoundingClientRect().top-top};
            const older=Array.from({length:90},(_,i)=>({id:'older-'+i,kind:'user',turnId:null,createdAt:i-90,text:'An older message '+i}));
            fixture.useChats.getState().prepend(key,'g:90',{items:older,history:{start:0,cursor:null}});
            for(let i=0;i<6;i++) await new Promise(requestAnimationFrame);
            const held=el.querySelector('[data-item-id="'+before.id+'"]');
            return {before,after:{id:held?.dataset.itemId,offset:held?.getBoundingClientRect().top-el.getBoundingClientRect().top}};
        })()`);
        if (anchor.before.id !== anchor.after.id || Math.abs(anchor.before.offset - anchor.after.offset) > 2) {
            console.log(JSON.stringify({ benchmark: 'timeline-scroll', count, initial, samples, anchor }, null, 2));
            throw new Error(`History moved the reading position: ${JSON.stringify(anchor)}`);
        }
        const following = await view.evaluate<{ readingOffset: number; gap: number; lastVisible: boolean }>(`(async()=>{
            const el=document.querySelector('.chat-scroll');
            const key=fixture.scope.keyOf('chat');
            const append=id=>fixture.useChats.getState().apply(key,{type:'item',item:{id,kind:'user',turnId:null,createdAt:100000,text:'A new message'}});
            append('appended-while-reading');
            for(let i=0;i<3;i++) await new Promise(requestAnimationFrame);
            const held=el.querySelector('[data-item-id="'+${JSON.stringify(anchor.before.id)}+'"]');
            const readingOffset=held?.getBoundingClientRect().top-el.getBoundingClientRect().top;
            fixture.scrollTimelineToEnd('chat','auto');
            for(let i=0;i<3;i++) await new Promise(requestAnimationFrame);
            append('appended-at-end');
            for(let i=0;i<6;i++) await new Promise(requestAnimationFrame);
            return {readingOffset,gap:el.scrollHeight-el.scrollTop-el.clientHeight,lastVisible:el.querySelector('[data-item-id="appended-at-end"]')!==null};
        })()`);
        if (
            !Number.isFinite(following.readingOffset) ||
            Math.abs(following.readingOffset - anchor.before.offset) > 2 ||
            following.gap > 2 ||
            !following.lastVisible
        ) {
            throw new Error(`Appending changed the scroll behavior: ${JSON.stringify(following)}`);
        }
        console.log(JSON.stringify({ benchmark: 'timeline-scroll', count, initial, samples, anchor, following }, null, 2));
        if (median(samples.map((sample) => sample.taskMs)) > Number(process.env.BENCH_MAX_TASK_MS ?? Infinity)) {
            throw new Error('Timeline scrolling exceeded its CPU budget');
        }
    },
    { production: true }
);
