import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { join } from 'node:path';
import { clientDirectory, withBrowserFixture } from '../../testing/browser-fixture';

const frame = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))';

/*
 * Counts React's commits and the components each one ran, the way the devtools hook sees them: a
 * fiber whose children are the ones it had bailed out with its whole subtree.
 */
const renderProbe = `
window.probe = { recording: false, commits: 0, renders: {} };
const nameOf = (fiber) => {
    const type = fiber.type;
    if (typeof type === 'function') return type.displayName || type.name || 'Anonymous';
    if (type && typeof type === 'object' && typeof type.render === 'function') return type.displayName || type.render.displayName || type.render.name || 'ForwardRef';
    return null;
};
const visit = (fiber, previous) => {
    const name = nameOf(fiber);
    if (name !== null && (previous === null || (fiber.flags & 1) !== 0)) {
        window.probe.renders[name] = (window.probe.renders[name] || 0) + 1;
    }
    if (previous !== null && fiber.child === previous.child) return;
    for (let child = fiber.child; child !== null; child = child.sibling) visit(child, child.alternate);
};
window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, isDisabled: false, renderers: new Map(),
    inject(renderer) { this.renderers.set(1, renderer); return 1; },
    checkDCE() {}, onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) {
        if (!window.probe.recording) return;
        window.probe.commits++;
        visit(root.current, root.current.alternate);
    }
};
`;

/* The shape of the canvas that was slow: one chat that added a hundred notes in a row beside it, with a line to each. */
function canvasView(notes: number) {
    const accents = [
        'purple',
        'cyan',
        'orange',
        'yellow',
        'red',
        'violet',
        'pink',
        'indigo',
        'amber',
        'emerald',
        'green',
        'teal',
        'sky',
        'fuchsia',
        'lime',
        'blue'
    ];
    const chat = { id: 'chat-a', kind: 'chat', title: 'Chat', titleSource: 'auto', x: 312, y: 168, w: 480, h: 520, provider: 'claude', providerFixed: true };
    const note = (i: number) => ({
        id: `note-${String(i).padStart(3, '0')}`,
        kind: 'note',
        title: `Note ${i + 1}`,
        titleSource: 'user',
        x: 832 + 360 * i,
        y: 168,
        w: 320,
        h: 240,
        accent: accents[i % accents.length],
        body: `Note ${i + 1}: something to think over.`
    });
    const edge = (i: number) => ({ id: `edge-${String(i).padStart(3, '0')}`, from: chat.id, to: note(i).id, role: 'origin' });
    return {
        view: {
            id: 'view-canvas',
            kind: 'canvas',
            name: 'Canvas',
            nodes: [chat, ...Array.from({ length: notes }, (_, i) => note(i))],
            texts: [],
            edges: Array.from({ length: notes }, (_, i) => edge(i)),
            layouts: []
        },
        note,
        edge
    };
}

async function builtStyles(): Promise<string> {
    // The stylesheet the client ships, built by `test:browser` before the suite, so layout and paint cost what they cost in the app.
    for (const file of new Glob('dist/assets/index-*.css').scanSync({ cwd: clientDirectory })) {
        return (await Bun.file(join(clientDirectory, file)).text()).replaceAll('</style', '');
    }
    throw new Error('Build the client first (`bun run --cwd apps/client build`), which `bun run test:browser` does.');
}

interface Measured {
    commits: number;
    renders: Record<string, number>;
    taskMs: number;
    scriptMs: number;
    layoutMs: number;
    styleMs: number;
}

/*
 * Budgets for the canvas that was slow: a pan that does no React work beyond the nodes it brings into
 * sight, and a new node that routes and renders only what it changed. Each budget sits several times
 * over what a laptop measures here and well under what the canvas cost before (in brackets), so a
 * slower machine passes and the old cost does not. `RUIMTE_CANVAS_REPORT=1` prints the numbers,
 * `RUIMTE_CANVAS_PROFILE=1` the functions the time went to and `RUIMTE_CANVAS_TRACE=1` the raster.
 */
const BUDGET = {
    // 1 to 3 ms (2 to 3 ms).
    wheelFrameMs: 8,
    // 4 to 7 ms (75 to 85 ms, waiting on the whole world being painted again every frame).
    dragFrameMs: 25,
    // Script alone, since the rest is the dots and handles near the pointer being painted: under 1 ms (800 ms, every line routed again for a dot near the pointer).
    pointerMoveScriptMs: 5,
    // 60 to 80 ms (1.4 to 1.7 s, every line routed twice and every frame rendered).
    addMs: 400
};

test('a canvas of a chat and a hundred lined notes pans without React work and takes a node in without drawing it all again', async () => {
    const { view: canvas, note, edge } = canvasView(100);
    await withBrowserFixture(
        `
        import { Canvas } from ${JSON.stringify(join(import.meta.dir, 'Canvas.tsx'))};
        import { defaultCanvasStore } from ${JSON.stringify(join(import.meta.dir, '../state/canvas.ts'))};
        import { useProject } from ${JSON.stringify(join(import.meta.dir, '../state/project.ts'))};
        import { ChatScopeProvider } from ${JSON.stringify(join(import.meta.dir, '../transport/ChatScopeProvider.tsx'))};
        import { ConnectionContext } from ${JSON.stringify(join(import.meta.dir, '../transport/context.ts'))};
        import { machineTransport } from ${JSON.stringify(join(import.meta.dir, '../transport/index.ts'))};
        ${['canvas', 'common', 'agents', 'chat', 'state']
            .map((namespace) => `import ${namespace}Words from ${JSON.stringify(join(import.meta.dir, `../i18n/locales/en/${namespace}.json`))};`)
            .join('\n')}
        for (const [namespace, words] of Object.entries({canvas: canvasWords, common: commonWords, agents: agentsWords, chat: chatWords, state: stateWords})) {
            i18next.addResourceBundle('en', namespace, words, true, true);
        }
        useProject.setState({current:{id:'project',projectId:'project',name:'Project',folder:'/project'}, rev: 1});
        defaultCanvasStore.getState().loadView(${JSON.stringify(canvas)}, {camera:{center:{x:1200,y:400},zoom:1}});
        window.canvas = defaultCanvasStore;
        window.project = useProject;
        createRoot(document.getElementById('root')).render(<UIProvider i18n={i18next}><ConnectionContext.Provider value={{endpointId:'fixture',transport:machineTransport('fixture')}}><ChatScopeProvider><Canvas/></ChatScopeProvider></ConnectionContext.Provider></UIProvider>);
        `,
        `${await builtStyles()}#root{width:1280px;height:800px}`,
        async (view) => {
            await view.resize(1280, 800);
            await view.evaluate(frame);
            await view.cdp('Performance.enable', {});
            const metrics = async (): Promise<Record<string, number>> => {
                const { metrics } = await view.cdp<{ metrics: { name: string; value: number }[] }>('Performance.getMetrics', {});
                return Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]));
            };
            const measure = async (act: () => Promise<void>): Promise<Measured> => {
                await view.evaluate('(() => { window.probe.commits = 0; window.probe.renders = {}; window.probe.recording = true; })()');
                const before = await metrics();
                await act();
                await view.evaluate(frame);
                const after = await metrics();
                const probe = await view.evaluate<{ commits: number; renders: Record<string, number> }>(
                    '(() => { window.probe.recording = false; return { commits: window.probe.commits, renders: window.probe.renders }; })()'
                );
                const ms = (name: string): number => Math.round((after[name]! - before[name]!) * 10000) / 10;
                return {
                    ...probe,
                    taskMs: ms('TaskDuration'),
                    scriptMs: ms('ScriptDuration'),
                    layoutMs: ms('LayoutDuration'),
                    styleMs: ms('RecalcStyleDuration')
                };
            };
            const profile = process.env.RUIMTE_CANVAS_PROFILE === '1';
            const report = profile || process.env.RUIMTE_CANVAS_TRACE === '1' || process.env.RUIMTE_CANVAS_REPORT === '1';
            const script = profile ? await (await fetch(await view.evaluate<string>('new URL("/entry.js", location.href).href'))).text() : '';
            const settle = (): Promise<unknown> => view.evaluate('new Promise(resolve => setTimeout(resolve, 300))');
            const scenario = async (name: string, act: () => Promise<void>): Promise<Measured> => {
                await settle();
                if (profile) {
                    await view.cdp('Profiler.enable', {});
                    await view.cdp('Profiler.setSamplingInterval', { interval: 100 });
                    await view.cdp('Profiler.start', {});
                }
                let traced: Promise<void> | null = null;
                if (process.env.RUIMTE_CANVAS_TRACE === '1') {
                    const events: { name: string; dur?: number; ph: string }[] = [];
                    const collect = ((event: { data: { value: typeof events } }) => events.push(...event.data.value)) as never;
                    view.addEventListener('Tracing.dataCollected', collect);
                    traced = new Promise<void>((resolve) => {
                        const complete = (() => {
                            view.removeEventListener('Tracing.dataCollected', collect);
                            view.removeEventListener('Tracing.tracingComplete', complete);
                            const total = (wanted: string): number =>
                                Math.round(
                                    events.filter((event) => event.ph === 'X' && event.name === wanted).reduce((sum, event) => sum + (event.dur ?? 0), 0) / 1000
                                );
                            console.log(
                                name,
                                'raster',
                                total('RasterTask'),
                                'paint',
                                total('Paint'),
                                'commit wait',
                                total('LayerTreeHost::WaitForCommitCompletion')
                            );
                            resolve();
                        }) as never;
                        view.addEventListener('Tracing.tracingComplete', complete);
                    });
                    await view.cdp('Tracing.start', { categories: 'devtools.timeline,blink,cc', transferMode: 'ReportEvents' });
                }
                const measured = await measure(act);
                if (traced !== null) {
                    await view.cdp('Tracing.end', {});
                    await traced;
                }
                if (report) {
                    console.log(name, JSON.stringify(measured));
                }
                if (profile) {
                    const { profile: cpu } = await view.cdp<{ profile: CpuProfile }>('Profiler.stop', {});
                    console.log(topFunctions(cpu, script));
                }
                return measured;
            };
            const panFrames = 30;
            const wheelPan = async (): Promise<void> => {
                for (let i = 0; i < panFrames; i++) {
                    await view.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 400, deltaX: 10, deltaY: 0 });
                    await view.evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
                }
            };
            const dragPan = async (): Promise<void> => {
                await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 760, button: 'middle', buttons: 4, clickCount: 1 });
                for (let i = 1; i <= panFrames; i++) {
                    await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640 - 10 * i, y: 760, button: 'middle', buttons: 4 });
                    await view.evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
                }
                await view.cdp('Input.dispatchMouseEvent', {
                    type: 'mouseReleased',
                    x: 640 - 10 * panFrames,
                    y: 760,
                    button: 'middle',
                    buttons: 0,
                    clickCount: 1
                });
            };
            const opened = await scenario('the view opened again', async () => {
                await view.evaluate(`(() => {
                    window.canvas.getState().loadView(null, null);
                    window.canvas.getState().loadView(${JSON.stringify(canvas)}, { camera: { center: { x: 1200, y: 400 }, zoom: 1 } });
                })()`);
            });
            // A first pan warms the caches and the JIT, as a person's second pan finds them.
            await wheelPan();
            const wheel = await scenario('wheel pan at 100%', wheelPan);
            const drag = await scenario('drag pan at 100%', dragPan);
            await view.evaluate('window.canvas.getState().fitAll()');
            await wheelPan();
            const overview = await scenario('wheel pan with everything in view', wheelPan);
            await view.evaluate('window.canvas.setState({ camera: { x: 0, y: 0, zoom: 1 } })');
            const hover = await scenario('pointer moves over the canvas', async () => {
                for (let i = 1; i <= panFrames; i++) {
                    await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200 + 20 * i, y: 720, buttons: 0 });
                    await view.evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
                }
            });
            const click = await scenario('a click on a note', async () => {
                await view.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1000, y: 300, button: 'left', buttons: 1, clickCount: 1 });
                await view.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1000, y: 300, button: 'left', buttons: 0, clickCount: 1 });
            });
            const added = await scenario('one node added', async () => {
                await view.evaluate(`(() => {
                    const state = window.canvas.getState();
                    const node = ${JSON.stringify(note(100))};
                    state.applyExternal({ nodes: [node], texts: [], edges: [${JSON.stringify(edge(100))}], removed: { nodes: [], texts: [], edges: [] }, order: [...state.order, node.id], layouts: null });
                    window.project.setState({ rev: window.project.getState().rev + 1 });
                })()`);
            });
            // An agent adding the hundred notes the way it did: one change per node, each drawn before the next arrives.
            const emptied = `window.canvas.getState().loadView(${JSON.stringify({ ...canvas, nodes: canvas.nodes.slice(0, 1), edges: [] })}, { camera: { center: { x: 1200, y: 400 }, zoom: 1 } })`;
            const grow = (from: number, to: number): string =>
                JSON.stringify({
                    nodes: Array.from({ length: to - from }, (_, i) => note(from + i)),
                    texts: [],
                    edges: Array.from({ length: to - from }, (_, i) => edge(from + i)),
                    removed: { nodes: [], texts: [], edges: [] },
                    layouts: null
                });
            await view.evaluate(emptied);
            const oneByOne = await scenario('a hundred notes, one change each', async () => {
                for (let i = 0; i < 100; i++) {
                    await view.evaluate(`(() => {
                        const state = window.canvas.getState();
                        const patch = ${grow(i, i + 1)};
                        state.applyExternal({ ...patch, order: [...state.order, ...patch.nodes.map((node) => node.id)] });
                    })()`);
                    await view.evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
                }
            });
            await view.evaluate(emptied);
            const together = await scenario('a hundred notes in one change', async () => {
                await view.evaluate(`(() => {
                    const state = window.canvas.getState();
                    const patch = ${grow(0, 100)};
                    state.applyExternal({ ...patch, order: [...state.order, ...patch.nodes.map((node) => node.id)] });
                })()`);
            });
            if (report) {
                console.log(
                    JSON.stringify({
                        hundredOneByOneMs: oneByOne.taskMs,
                        hundredTogetherMs: together.taskMs
                    })
                );
                console.log(
                    JSON.stringify({
                        msPerFrame: [wheel, drag, overview].map((measured) => Math.round((measured.taskMs / panFrames) * 10) / 10),
                        commitsPerPan: [wheel, drag, overview].map((measured) => measured.commits),
                        addMs: added.taskMs,
                        pointerMoveMs: Math.round((hover.taskMs / panFrames) * 10) / 10,
                        pointerMoveScriptMs: Math.round((hover.scriptMs / panFrames) * 10) / 10,
                        clickMs: click.taskMs,
                        openMs: opened.taskMs,
                        framesInPage: await view.evaluate<number>('document.querySelectorAll("[data-node-id]").length')
                    })
                );
            }
            // A pan moves the world by hand: what renders is a node coming into sight, never the canvas, its lines or its overlays.
            // A drag starts and ends a gesture, which the canvas renders for, once each and not per frame.
            for (const [pan, allowed] of [
                [wheel, 0],
                [overview, 0],
                [drag, 4]
            ] as const) {
                for (const name of ['EdgeLayer', 'EdgeRow', 'AlignmentGuides', 'TextToolbar', 'CanvasLineToolbar', 'Minimap']) {
                    expect(`${name} ${pan.renders[name] ?? 0}`).toBe(`${name} ${Math.min(allowed, pan.renders[name] ?? 0)}`);
                }
            }
            expect(wheel.commits).toBeLessThanOrEqual(10);
            expect(wheel.taskMs / panFrames).toBeLessThan(BUDGET.wheelFrameMs);
            expect(overview.taskMs / panFrames).toBeLessThan(BUDGET.wheelFrameMs);
            expect(drag.taskMs / panFrames).toBeLessThan(BUDGET.dragFrameMs);
            expect(hover.scriptMs / panFrames).toBeLessThan(BUDGET.pointerMoveScriptMs);
            expect(added.taskMs).toBeLessThan(BUDGET.addMs);
            // A hundred notes that arrive in one change cost about what one does (1.3 s before).
            expect(together.taskMs).toBeLessThan(BUDGET.addMs);
            // The new note and its line, not the hundred that were there.
            expect(added.renders.NodeFrameContent ?? 0).toBeLessThanOrEqual(2);
            expect(added.renders.EdgeRow ?? 0).toBeLessThanOrEqual(4);
            expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
        },
        { head: renderProbe, production: process.env.RUIMTE_CANVAS_DEVELOPMENT !== '1' }
    );
}, 120000);

interface CpuProfile {
    nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }[];
    samples: number[];
    timeDeltas: number[];
}

/* Self time per function, named after the module the bundle says it came from. */
function topFunctions(profile: CpuProfile, script: string): string {
    const modules: { line: number; path: string }[] = [];
    script.split('\n').forEach((text, line) => {
        const match = /^\/\/ (\S+\.(?:tsx?|jsx?|mjs))$/.exec(text);
        if (match) {
            modules.push({ line, path: match[1]! });
        }
    });
    const moduleAt = (line: number): string => {
        let found = '?';
        for (const module of modules) {
            if (module.line > line) {
                break;
            }
            found = module.path;
        }
        return found.split('/').slice(-2).join('/');
    };
    const byId = new Map(profile.nodes.map((node) => [node.id, node]));
    const self = new Map<string, number>();
    profile.samples.forEach((id, index) => {
        const node = byId.get(id)!;
        const { functionName, url, lineNumber } = node.callFrame;
        const key = url.endsWith('/entry.js') ? `${functionName || '(anonymous)'} ${moduleAt(lineNumber)}` : functionName || url || '(program)';
        self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000);
    });
    return [...self]
        .sort((first, second) => second[1] - first[1])
        .slice(0, 25)
        .map(([key, ms]) => `${ms.toFixed(1).padStart(8)} ms  ${key}`)
        .join('\n');
}
