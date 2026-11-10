import { join } from 'node:path';

type CdpMetrics = { metrics: { name: string; value: number }[] };

export function median(samples: readonly number[]): number {
    return samples.toSorted((left, right) => left - right)[Math.floor(samples.length / 2)]!;
}

export function cpuTaskMs(before: CdpMetrics, after: CdpMetrics): number {
    const seconds = (sample: CdpMetrics): number => sample.metrics.find((row) => row.name === 'TaskDuration')?.value ?? 0;
    return 1000 * (seconds(after) - seconds(before));
}

/* A free port on loopback, for a daemon that is about to claim it. */
export async function reservedPort(): Promise<number> {
    const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
    const port = reservation.port!;
    await reservation.stop(true);
    return port;
}

/* A daemon from source on `port` with nothing outside the machine running, or the compiled one `BENCH_DAEMON_BINARY` names. */
export function spawnBenchDaemon(home: string, port: number, binary?: string) {
    const daemon = binary
        ? [binary]
        : [
              process.execPath,
              '--conditions=source',
              ...(process.env.BENCH_DAEMON_PRELOAD ? ['--preload', process.env.BENCH_DAEMON_PRELOAD] : []),
              'src/main.ts'
          ];
    return Bun.spawn(
        [
            ...daemon,
            '--host',
            '127.0.0.1',
            '--port',
            String(port),
            '--no-hooks',
            '--no-broker',
            '--no-lan',
            '--no-stun',
            '--no-model-fetch',
            '--no-price-fetch'
        ],
        { cwd: join(import.meta.dir, '../../../server'), env: { ...process.env, RUIMTE_HOME: home }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }
    );
}

export async function stopBenchDaemon(child: Bun.Subprocess): Promise<void> {
    child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    await child.exited;
    clearTimeout(timeout);
}

const DIALOG_PROBE = `(()=>{window.benchDialog=(key)=>new Promise((resolve,reject)=>{
    const start=performance.now();
    const timeout=setTimeout(()=>reject(new Error('Dialog did not open: '+key)),15000);
    const observer=new MutationObserver(()=>{if(document.querySelector('[role=dialog]')){
        observer.disconnect();clearTimeout(timeout);requestAnimationFrame(()=>resolve(performance.now()-start));
    }});
    observer.observe(document.body,{subtree:true,childList:true});
    const apple=navigator.platform.includes('Mac');
    window.dispatchEvent(new KeyboardEvent('keydown',{key,code:key===','?'Comma':'KeyK',metaKey:apple,ctrlKey:!apple,bubbles:true}));
});window.benchClose=()=>new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Dialog did not close')),10000);
    const check=()=>{if(!document.querySelector('[role=dialog]')){clearTimeout(timeout);resolve()}else requestAnimationFrame(check)};
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));check();
});})()`;

/* How long Settings and the palette take to open by their shortcuts, the first time and once warm. */
export async function measureDialogs(view: InstanceType<typeof Bun.WebView>): Promise<Record<string, number>> {
    await view.evaluate(DIALOG_PROBE);
    const dialogs: Record<string, number> = {};
    for (const [name, key] of [
        ['settings', ','],
        ['palette', 'k']
    ] as const) {
        for (const suffix of ['', 'Warm']) {
            dialogs[`${name}${suffix}`] = await view.evaluate<number>(`window.benchDialog(${JSON.stringify(key)})`);
            await view.evaluate('window.benchClose()');
        }
    }
    return dialogs;
}
