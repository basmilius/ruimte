import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const baselineRoot = process.argv[2];
if (!baselineRoot) {
    throw new Error('Usage: bun scripts/benchmark-protocol-browser.ts <adecore before checkout>');
}

const candidateRoot = resolve(import.meta.dir, '..');
const directory = await mkdtemp(join(tmpdir(), 'ruimte-details-browser-'));
let view: InstanceType<typeof Bun.WebView> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;

try {
    const entry = join(directory, 'entry.ts');
    await Bun.write(
        entry,
        `
        import * as before from ${JSON.stringify(resolve(baselineRoot, 'packages/agent-contracts/src/envelope.ts'))};
        import * as after from ${JSON.stringify(resolve(candidateRoot, '../adecore/packages/agent-contracts/src/envelope.ts'))};
        import { protocolCases } from ${JSON.stringify(join(candidateRoot, 'apps/client/testing/performance/protocol-cases.ts'))};
        import { measurePairs } from ${JSON.stringify(join(candidateRoot, 'apps/client/testing/performance/paired.ts'))};
        window.runBenchmark = () => ({ userAgent: navigator.userAgent, ...measurePairs(protocolCases(before, after)) });
    `
    );

    const bundle = await Bun.build({ entrypoints: [entry], target: 'browser', conditions: ['source'], minify: true });

    if (!bundle.success) {
        throw new AggregateError(bundle.logs, 'Could not build browser benchmark');
    }

    const script = await bundle.outputs[0]!.text();

    server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: (request) =>
            new URL(request.url).pathname === '/benchmark.js'
                ? new Response(script, { headers: { 'Content-Type': 'text/javascript' } })
                : new Response(
                      '<!doctype html><script>window.errors=[];window.addEventListener("error", event=>window.errors.push(event.message));</script><script type="module" src="/benchmark.js"></script>',
                      { headers: { 'Content-Type': 'text/html' } }
                  )
    });

    view = new Bun.WebView({ backend: { type: 'chrome', url: false }, headless: true, dataStore: { directory: join(directory, 'profile') } });
    await view.navigate(`http://127.0.0.1:${server.port}`);
    await view.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const errors = await view.evaluate<string[]>('window.errors');

    if (errors.length > 0) {
        throw new Error(errors.join('\n'));
    }
    const result = await view.evaluate<Record<string, unknown>>('window.runBenchmark()');
    console.log(JSON.stringify({ baselineRoot, candidateRoot, ...result }, null, 2));
} finally {
    view?.close();
    await server?.stop(true);
    await rm(directory, { recursive: true, force: true });
}
