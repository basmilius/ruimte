import { cpuTaskMs } from './bench';
import { withProjectFixture } from './project-fixture';
import { measureRestore } from './restore';

const views = Number(process.env.BENCH_VIEWS ?? 1000);
const throttle = Number(process.env.BENCH_CPU_RATE ?? 1);
if (!Number.isInteger(views) || views < 100 || !Number.isFinite(throttle) || throttle < 1) {
    throw new Error('BENCH_VIEWS must be at least 100 and BENCH_CPU_RATE must be at least 1');
}
await withProjectFixture({ projects: 1, views }, async (fixture) => {
    const result = await measureRestore({
        ...fixture,
        settings: { language: 'en' },
        async probe(view) {
            await view.evaluate('new Promise(resolve=>setTimeout(resolve,500))');
            await view.cdp('Emulation.setCPUThrottlingRate', { rate: throttle });
            await view.cdp('Performance.enable');
            await view.evaluate(`(()=>{
                window.benchKeys=[];window.benchEvents=[];window.benchLongTasks=[];
                new PerformanceObserver(list=>window.benchEvents.push(...list.getEntries().filter(row=>row.interactionId).map(row=>({name:row.name,duration:row.duration,processingMs:row.processingEnd-row.processingStart,inputDelayMs:row.processingStart-row.startTime,interactionId:row.interactionId})))).observe({type:'event',buffered:true,durationThreshold:16});
                new PerformanceObserver(list=>window.benchLongTasks.push(...list.getEntries().map(row=>({start:row.startTime,duration:row.duration})))).observe({type:'longtask'});
                document.addEventListener('keydown',event=>{
                    if(!document.querySelector('[role=dialog]'))return;
                    const start=performance.now(),stamp=event.timeStamp;
                    requestAnimationFrame(()=>requestAnimationFrame(()=>window.benchKeys.push({key:event.key,processingStartMs:start-stamp,twoFrameMs:performance.now()-stamp})));
                },true);
                window.benchFrames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            })()`);
            const phases = [];
            for (const [name, shortcut, query] of [
                ['palette', 'k', 'chat 99'],
                ['settings', ',', 'editor']
            ]) {
                if (name === 'palette' && process.env.BENCH_PROFILE) {
                    await view.cdp('Profiler.enable');
                    await view.cdp('Profiler.start');
                }
                const before = (await view.cdp('Performance.getMetrics')) as { metrics: { name: string; value: number }[] };
                await view.evaluate(
                    `(()=>{window.benchKeys=[];window.benchEvents=[];window.benchLongTasks=[];window.benchOpenedAt=null;
                    const opening=new MutationObserver(()=>{if(document.querySelector(${JSON.stringify(name === 'palette' ? '[role=dialog] input[role=combobox]' : '[role=dialog] input[placeholder="Search settings"]')})){window.benchOpenedAt=performance.now();opening.disconnect()}});
                    opening.observe(document.documentElement,{childList:true,subtree:true});
                    window.benchPhaseStart=performance.now();window.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(shortcut)},code:${JSON.stringify(shortcut === 'k' ? 'KeyK' : 'Comma')},metaKey:true,bubbles:true}));return window.benchFrames();})()`
                );
                await view.evaluate(
                    `new Promise((resolve,reject)=>{const deadline=performance.now()+10000;const next=()=>{const input=document.querySelector(${JSON.stringify(name === 'palette' ? '[role=dialog] input[role=combobox]' : '[role=dialog] input[placeholder="Search settings"]')});if(input){input.focus();resolve()}else if(performance.now()>deadline)reject(new Error('Missing ${name} input'));else requestAnimationFrame(next)};next()})`
                );
                const opened = await view.evaluate<number>(
                    `(()=>{if(window.benchOpenedAt===null)throw new Error('Missing dialog opening timestamp');return window.benchOpenedAt-window.benchPhaseStart})()`
                );
                for (const [keyIndex, key] of [...query!, ...Array.from(query!, () => 'Backspace')].entries()) {
                    await view.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, ...(key === 'Backspace' ? { windowsVirtualKeyCode: 8 } : { text: key }) });
                    await view.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key });
                    await view.evaluate('window.benchFrames()');
                    if (name === 'palette' && keyIndex === query!.length - 1) {
                        const matches = await view.evaluate<{ first: string; count: number }>(
                            `({first:document.querySelector('[role=option]')?.textContent??'',count:Number(document.querySelector('[role=option]')?.getAttribute('aria-setsize')??document.querySelectorAll('[role=option]').length)})`
                        );
                        const expected = Array.from({ length: views }, (_, index) => index).filter((index) => String(index).includes('99')).length;
                        if (!matches.first.startsWith('Chat 99') || matches.count !== expected) {
                            throw new Error('Palette did not filter the typed query: ' + JSON.stringify(matches));
                        }
                    }
                }
                const arrows = [];
                if (name === 'palette') {
                    for (let index = 0; index < 20; index++) {
                        const previous = await view.evaluate<string | null>('document.activeElement.getAttribute("aria-activedescendant")');
                        await view.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', windowsVirtualKeyCode: 40 });
                        await view.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', windowsVirtualKeyCode: 40 });
                        await view.evaluate('window.benchFrames()');
                        const current = await view.evaluate<string | null>(
                            `(()=>{const id=document.activeElement.getAttribute('aria-activedescendant');const row=document.getElementById(id);if(!row)throw new Error('Highlighted row is not mounted: '+id);const rect=row.getBoundingClientRect(),list=document.querySelector('[role=listbox]').getBoundingClientRect();if(rect.bottom<=list.top||rect.top>=list.bottom)throw new Error('Highlighted row is outside the viewport: '+id);return id})()`
                        );
                        if (!current || previous === current) {
                            throw new Error('Palette selection did not follow ArrowDown');
                        }
                        arrows.push(current);
                    }
                }
                const after = (await view.cdp('Performance.getMetrics')) as typeof before;
                const audit = await view.evaluate<{
                    keys: { key: string; twoFrameMs: number }[];
                    events: unknown[];
                    longTasks: { start: number; duration: number }[];
                    value: string;
                    options: number;
                    logicalOptions: number;
                    errors: string[];
                }>(
                    `({keys:window.benchKeys,events:window.benchEvents,longTasks:window.benchLongTasks,value:document.activeElement.value,options:document.querySelectorAll('[role=option]').length,logicalOptions:Number(document.querySelector('[role=option]')?.getAttribute('aria-setsize')??document.querySelectorAll('[role=option]').length),errors:window.benchErrors})`
                );
                if (audit.value !== '' || audit.errors.length > 0 || (name === 'palette' && audit.logicalOptions !== views + 5)) {
                    throw new Error('UI interaction audit failed: ' + JSON.stringify(audit));
                }
                if (name === 'palette' && process.env.BENCH_PROFILE) {
                    await Bun.write(process.env.BENCH_PROFILE, JSON.stringify(await view.cdp('Profiler.stop')));
                }
                phases.push({ name, openedMs: opened, taskMs: cpuTaskMs(before, after), arrows: arrows.length, ...audit });
                await view.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 });
                await view.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', windowsVirtualKeyCode: 27 });
                await view.evaluate(
                    `new Promise((resolve,reject)=>{const deadline=performance.now()+10000;const next=()=>{if(!document.querySelector('[role=dialog]'))resolve();else if(performance.now()>deadline)reject(new Error('Dialog did not close'));else requestAnimationFrame(next)};next()})`
                );
            }
            if (process.env.BENCH_NAVIGATION_SMOKE === '1') {
                await view.evaluate(
                    `(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',code:'KeyK',metaKey:true,bubbles:true}));return new Promise(resolve=>setTimeout(resolve,300))})()`
                );
                await view.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowUp', windowsVirtualKeyCode: 38 });
                await view.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', windowsVirtualKeyCode: 38 });
                await view.evaluate('window.benchFrames()');
                const last = await view.evaluate<{ label: string; position: number; visible: boolean }>(
                    `(()=>{const row=document.getElementById(document.activeElement.getAttribute('aria-activedescendant'));if(!row)return{label:'',position:0,visible:false};const rect=row.getBoundingClientRect(),list=document.querySelector('[role=listbox]').getBoundingClientRect();return{label:row.textContent,position:Number(row.getAttribute('aria-posinset')??document.querySelectorAll('[role=option]').length),visible:rect.bottom>list.top&&rect.top<list.bottom}})()`
                );
                if (!last.label.startsWith('Settings') || last.position !== views + 5 || !last.visible) {
                    throw new Error('Jumping to the final palette result failed: ' + JSON.stringify(last));
                }
                await view.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13 });
                await view.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13 });
                await view.evaluate(
                    `new Promise((resolve,reject)=>{const deadline=performance.now()+10000;const next=()=>{if(document.querySelector('input[placeholder="Search settings"]')&&!document.querySelector('input[role=combobox]'))resolve();else if(performance.now()>deadline)reject(new Error('Enter did not run the final result'));else requestAnimationFrame(next)};next()})`
                );
                await view.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 });
                await view.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', windowsVirtualKeyCode: 27 });
            }
            return phases;
        }
    });
    console.log(JSON.stringify({ benchmark: 'ui-response', views, throttle, navigationSmoke: process.env.BENCH_NAVIGATION_SMOKE === '1', result }, null, 2));
    const durations = result.samples
        .flatMap((sample) => (sample.probe as { keys: { twoFrameMs: number }[] }[]).flatMap((phase) => phase.keys.map((key) => key.twoFrameMs)))
        .toSorted((left, right) => left - right);
    if (durations[Math.floor(durations.length * 0.95)]! > Number(process.env.BENCH_MAX_P95_MS ?? Infinity)) {
        throw new Error('UI responsiveness exceeded its p95 keyboard budget');
    }
});
