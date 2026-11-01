import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const baselineRoot = process.argv[2];
const suite = process.argv[3] ?? 'details';

if (
    !baselineRoot ||
    !['details', 'sweep', 'edges', 'gaps', 'stacking', 'plans', 'routes', 'selections', 'drawings', 'plan-search', 'plan-permissions'].includes(suite)
) {
    throw new Error(
        'Usage: bun scripts/benchmark-browser-details.ts <baseline checkout> [details|sweep|edges|gaps|stacking|plans|routes|selections|drawings|plan-search|plan-permissions]'
    );
}

const candidateRoot = resolve(import.meta.dir, '..');
const directory = await mkdtemp(join(tmpdir(), 'ruimte-details-browser-'));
let view: InstanceType<typeof Bun.WebView> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;

try {
    const entry = join(directory, 'entry.ts');
    const moduleAt = (root: string, name: string) => JSON.stringify(resolve(root, `apps/client/src/canvas/${name}.ts`));

    await Bun.write(
        entry,
        suite === 'plan-permissions'
            ? `
        import * as beforeTree from ${JSON.stringify(resolve(baselineRoot, 'packages/plan/src/tree.ts'))};
        import * as beforePermissions from ${JSON.stringify(resolve(baselineRoot, 'packages/plan/src/permissions.ts'))};
        import * as beforeApply from ${JSON.stringify(resolve(baselineRoot, 'packages/plan/src/apply.ts'))};
        import * as afterTree from ${JSON.stringify(resolve(candidateRoot, '../adecore/packages/plan/src/tree.ts'))};
        import * as afterPermissions from ${JSON.stringify(resolve(candidateRoot, '../adecore/packages/plan/src/permissions.ts'))};
        import * as afterApply from ${JSON.stringify(resolve(candidateRoot, '../adecore/packages/plan/src/apply.ts'))};
        import { planPermissionCases } from ${JSON.stringify(resolve(candidateRoot, '../adecore/scripts/plan-permission-performance-cases.ts'))};
        import { measurePairs } from ${JSON.stringify(join(candidateRoot, 'apps/client/testing/performance/paired.ts'))};
        window.runBenchmark = () => ({ userAgent: navigator.userAgent, ...measurePairs(planPermissionCases({ ...beforeTree, ...beforePermissions, ...beforeApply }, { ...afterTree, ...afterPermissions, ...afterApply })) });
        `
            : suite === 'plan-search'
              ? `
        import * as beforeTree from ${JSON.stringify(resolve(baselineRoot, 'packages/plan/src/tree.ts'))};
        import * as beforeApply from ${JSON.stringify(resolve(baselineRoot, 'packages/plan/src/apply.ts'))};
        import * as afterTree from ${JSON.stringify(resolve(candidateRoot, '../adecore/packages/plan/src/tree.ts'))};
        import * as afterApply from ${JSON.stringify(resolve(candidateRoot, '../adecore/packages/plan/src/apply.ts'))};
        import { planSearchCases } from ${JSON.stringify(resolve(candidateRoot, '../adecore/scripts/plan-search-performance-cases.ts'))};
        import { measurePairs } from ${JSON.stringify(join(candidateRoot, 'apps/client/testing/performance/paired.ts'))};
        window.runBenchmark = () => ({ userAgent: navigator.userAgent, ...measurePairs(planSearchCases({ ...beforeTree, ...beforeApply }, { ...afterTree, ...afterApply })) });
        `
              : suite === 'drawings'
                ? `
        import * as before from ${JSON.stringify(resolve(baselineRoot, 'packages/drawing/src/reading-order.ts'))};
        import * as after from ${JSON.stringify(resolve(candidateRoot, '../adecore/packages/drawing/src/reading-order.ts'))};
        import { drawingCases } from ${JSON.stringify(resolve(candidateRoot, '../adecore/scripts/drawing-performance-cases.ts'))};
        import { measurePairs } from ${JSON.stringify(join(candidateRoot, 'apps/client/testing/performance/paired.ts'))};
        window.runBenchmark = () => ({ userAgent: navigator.userAgent, ...measurePairs(drawingCases(before, after)) });
        `
                : suite === 'selections'
                  ? `
        import * as before from ${JSON.stringify(resolve(baselineRoot, 'packages/editor-core/src/document.ts'))};
        import * as after from ${JSON.stringify(resolve(candidateRoot, '../adecore/packages/editor-core/src/document.ts'))};
        import { selectionCases } from ${JSON.stringify(resolve(candidateRoot, '../adecore/scripts/selection-performance-cases.ts'))};
        import { measurePairs } from ${JSON.stringify(join(candidateRoot, 'apps/client/testing/performance/paired.ts'))};
        window.runBenchmark = () => ({ userAgent: navigator.userAgent, ...measurePairs(selectionCases(before, after)) });
        `
                  : suite === 'routes'
                    ? `
        import * as before from ${moduleAt(baselineRoot, 'edge-route')};
        import * as after from ${moduleAt(candidateRoot, 'edge-route')};
        import { routeCases } from ${JSON.stringify(join(candidateRoot, 'apps/client/testing/performance/route-cases.ts'))};
        import { measurePairs } from ${JSON.stringify(join(candidateRoot, 'apps/client/testing/performance/paired.ts'))};
        window.runBenchmark = () => ({ userAgent: navigator.userAgent, ...measurePairs(routeCases(before, after)) });
        `
                    : suite === 'plans'
                      ? `
        import * as before from ${JSON.stringify(resolve(baselineRoot, 'packages/plan/src/apply.ts'))};
        import * as after from ${JSON.stringify(resolve(candidateRoot, '../adecore/packages/plan/src/apply.ts'))};
        import { planCases } from ${JSON.stringify(resolve(candidateRoot, '../adecore/scripts/plan-performance-cases.ts'))};
        import { measurePairs } from ${JSON.stringify(join(candidateRoot, 'apps/client/testing/performance/paired.ts'))};
        window.runBenchmark = () => ({ userAgent: navigator.userAgent, ...measurePairs(planCases(before, after)) });
        `
                      : suite === 'stacking'
                        ? `
        import * as before from ${moduleAt(baselineRoot, 'stacking')};
        import * as after from ${moduleAt(candidateRoot, 'stacking')};
        import { measureStacking } from ${JSON.stringify(join(candidateRoot, 'apps/client/testing/performance/stacking-cases.ts'))};
        window.runBenchmark = () => ({ userAgent: navigator.userAgent, ...measureStacking(before, after) });
        `
                        : suite === 'gaps'
                          ? `
        import * as before from ${moduleAt(baselineRoot, 'editable-gaps')};
        import * as after from ${moduleAt(candidateRoot, 'editable-gaps')};
        import { measureGapSweep } from ${JSON.stringify(join(candidateRoot, 'apps/client/testing/performance/sweep-cases.ts'))};
        window.runBenchmark = () => ({ userAgent: navigator.userAgent, ...measureGapSweep(before, after) });
        `
                          : suite === 'edges'
                            ? `
        import * as before from ${moduleAt(baselineRoot, 'edge-lines')};
        import * as after from ${moduleAt(candidateRoot, 'edge-lines')};
        import { measureEdgeSweep } from ${JSON.stringify(join(candidateRoot, 'apps/client/testing/performance/sweep-cases.ts'))};
        window.runBenchmark = () => ({ userAgent: navigator.userAgent, ...measureEdgeSweep(before, after) });
        `
                            : suite === 'sweep'
                              ? `
        import * as beforeEdges from ${moduleAt(baselineRoot, 'edge-lines')};
        import * as beforeNavigation from ${moduleAt(baselineRoot, 'node-navigation')};
        import * as beforeGaps from ${moduleAt(baselineRoot, 'editable-gaps')};
        import * as beforeBase64 from ${JSON.stringify(resolve(baselineRoot, 'apps/client/src/base64.ts'))};
        import * as afterEdges from ${moduleAt(candidateRoot, 'edge-lines')};
        import * as afterNavigation from ${moduleAt(candidateRoot, 'node-navigation')};
        import * as afterGaps from ${moduleAt(candidateRoot, 'editable-gaps')};
        import * as afterBase64 from ${JSON.stringify(resolve(candidateRoot, 'apps/client/src/base64.ts'))};
        import { measureClientSweep } from ${JSON.stringify(join(candidateRoot, 'apps/client/testing/performance/sweep-cases.ts'))};
        window.runBenchmark = () => ({ userAgent: navigator.userAgent, ...measureClientSweep({ ...beforeEdges, ...beforeNavigation, ...beforeGaps, ...beforeBase64 }, { ...afterEdges, ...afterNavigation, ...afterGaps, ...afterBase64 }) });
        `
                              : `
        import * as beforeFrames from ${moduleAt(baselineRoot, 'element-frames')};
        import * as beforeMap from ${moduleAt(baselineRoot, 'minimap-geometry')};
        import * as afterFrames from ${moduleAt(candidateRoot, 'element-frames')};
        import * as afterMap from ${moduleAt(candidateRoot, 'minimap-geometry')};
        import { measureCanvasDetails } from ${JSON.stringify(join(candidateRoot, 'apps/client/testing/performance/canvas-details.ts'))};
        window.runBenchmark = () => ({ userAgent: navigator.userAgent, ...measureCanvasDetails({ ...beforeFrames, ...beforeMap }, { ...afterFrames, ...afterMap }) });
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
