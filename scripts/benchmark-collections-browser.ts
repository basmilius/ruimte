import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const baselineRoot = process.argv[2];
if (!baselineRoot) {
    throw new Error('Usage: bun scripts/benchmark-collections-browser.ts <materialized before root> [name filter]');
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
        import * as beforeTree from ${JSON.stringify(resolve(baselineRoot, 'adecore/packages/plan/src/tree.ts'))};
        import * as beforeText from ${JSON.stringify(resolve(baselineRoot, 'adecore/packages/plan/src/text.ts'))};
        import * as beforeGroups from ${JSON.stringify(resolve(baselineRoot, 'ruimte/packages/contracts/src/node-defaults.ts'))};
        import * as afterTree from ${JSON.stringify(resolve(candidateRoot, '../adecore/packages/plan/src/tree.ts'))};
        import * as afterText from ${JSON.stringify(resolve(candidateRoot, '../adecore/packages/plan/src/text.ts'))};
        import * as afterGroups from ${JSON.stringify(resolve(candidateRoot, 'packages/contracts/src/node-defaults.ts'))};
        import { planCollectionCases } from ${JSON.stringify(resolve(candidateRoot, '../adecore/scripts/plan-collection-performance-cases.ts'))};
        import { groupMembershipCases } from ${JSON.stringify(resolve(candidateRoot, 'apps/client/testing/performance/group-membership-cases.ts'))};
        import { measurePairs } from ${JSON.stringify(resolve(candidateRoot, 'apps/client/testing/performance/paired.ts'))};
        const cases = [...planCollectionCases({ ...beforeTree, ...beforeText }, { ...afterTree, ...afterText }), ...groupMembershipCases(beforeGroups, afterGroups)];
        const filter = ${JSON.stringify(process.argv[3] ?? '')};
        window.runBenchmark = () => ({ userAgent: navigator.userAgent, ...measurePairs(filter ? cases.filter(entry => new RegExp(filter).test(entry.name)) : cases) });
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
