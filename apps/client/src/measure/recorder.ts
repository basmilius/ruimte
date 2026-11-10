import { webglTerminals } from '@adecore/terminal';
import { mountCounts } from '@/measure/mounts';
import { byType, distribution, frameSummary, heapSummary, round, type HeapSample } from '@/measure/summary';

/*
 * Dev-only: what the page costs while a person works in a measurement scene (`measure/scene.ts`).
 * Loaded only through the palette's measurement rows, so a production build carries none of it.
 */

const HEAP_SAMPLE_MS = 1000;
// The Event Timing API reports nothing shorter; the own probe below sees every input.
const EVENT_TIMING_THRESHOLD_MS = 16;
const INPUTS = ['keydown', 'pointerdown', 'wheel'] as const;

interface Samples {
    startedAt: number;
    frames: number[];
    inputs: { type: string; ms: number }[];
    eventTimings: { type: string; ms: number }[];
    longFrames: number[];
    heap: HeapSample[];
    contextsLost: number;
}

interface ChromiumMemory {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
}

type WebglContext = WebGLRenderingContext | WebGL2RenderingContext;

const contexts: WeakRef<WebglContext>[] = [];
let contextsCreated = 0;
let current: Samples | null = null;
let scene: unknown = null;
let stop: (() => void) | null = null;

function freshWindow(): Samples {
    return { startedAt: performance.now(), frames: [], inputs: [], eventTimings: [], longFrames: [], heap: [], contextsLost: 0 };
}

/* The page has no list of its WebGL contexts, so the recorder notes each one as it is made. Installed before the scene mounts its terminals. */
function watchWebglContexts(): void {
    const prototype = HTMLCanvasElement.prototype as unknown as { getContext(this: HTMLCanvasElement, type: string, ...rest: unknown[]): unknown };
    const original = prototype.getContext;
    const seen = new WeakSet<object>();
    prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]): unknown {
        const context = original.call(this, type, ...rest);
        if (context !== null && (type === 'webgl' || type === 'webgl2') && !seen.has(context as object)) {
            seen.add(context as object);
            contexts.push(new WeakRef(context as WebglContext));
            contextsCreated += 1;
        }
        return context;
    };
}

function liveContexts(): WebglContext[] {
    return contexts.flatMap((ref) => {
        const context = ref.deref();
        return context !== undefined && !context.isContextLost() ? [context] : [];
    });
}

function sampleHeap(samples: Samples): void {
    const memory = (performance as unknown as { memory?: ChromiumMemory }).memory;
    if (memory) {
        samples.heap.push({ usedBytes: memory.usedJSHeapSize, totalBytes: memory.totalJSHeapSize, limitBytes: memory.jsHeapSizeLimit });
    }
}

function observe(type: string, handle: (entries: PerformanceEntryList) => void, options: Record<string, unknown> = {}): () => void {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) {
        return () => {};
    }
    const observer = new PerformanceObserver((list) => handle(list.getEntries()));
    observer.observe({ type, ...options } as PerformanceObserverInit);
    return () => observer.disconnect();
}

function startWindow(): () => void {
    const samples = freshWindow();
    current = samples;
    let last: number | null = null;
    let frame = requestAnimationFrame(function tick(at: number) {
        if (last !== null) {
            samples.frames.push(at - last);
        }
        last = at;
        frame = requestAnimationFrame(tick);
    });
    const pending = new Set<string>();
    const channel = new MessageChannel();
    const afterPaint: (() => void)[] = [];
    channel.port1.onmessage = () => afterPaint.shift()?.();
    // From the event's own time to just after the frame that follows its handlers, one probe per type per frame.
    const onInput = (e: Event): void => {
        if (pending.has(e.type)) {
            return;
        }
        pending.add(e.type);
        const at = e.timeStamp;
        requestAnimationFrame(() => {
            afterPaint.push(() => {
                pending.delete(e.type);
                samples.inputs.push({ type: e.type, ms: performance.now() - at });
            });
            channel.port2.postMessage(null);
        });
    };
    const onLost = (): void => {
        samples.contextsLost += 1;
    };
    for (const type of INPUTS) {
        globalThis.addEventListener(type, onInput, { capture: true, passive: true });
    }
    globalThis.addEventListener('webglcontextlost', onLost, { capture: true });
    const heap = setInterval(() => sampleHeap(samples), HEAP_SAMPLE_MS);
    sampleHeap(samples);
    const stopEvents = observe(
        'event',
        (entries) => {
            for (const entry of entries) {
                samples.eventTimings.push({ type: entry.name, ms: entry.duration });
            }
        },
        { durationThreshold: EVENT_TIMING_THRESHOLD_MS }
    );
    const stopLongFrames = observe('long-animation-frame', (entries) => {
        for (const entry of entries) {
            samples.longFrames.push(entry.duration);
        }
    });
    return () => {
        cancelAnimationFrame(frame);
        clearInterval(heap);
        for (const type of INPUTS) {
            globalThis.removeEventListener(type, onInput, { capture: true });
        }
        globalThis.removeEventListener('webglcontextlost', onLost, { capture: true });
        channel.port1.close();
        stopEvents();
        stopLongFrames();
    };
}

export function startRecording(facts: unknown = scene): void {
    scene = facts;
    stop?.();
    stop = startWindow();
}

function pageStart(): Record<string, unknown> {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const paint = performance.getEntriesByName('first-contentful-paint')[0];
    const scripts = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter((entry) => entry.name.split('?')[0]!.endsWith('.js'));
    return {
        domContentLoadedMs: navigation ? round(navigation.domContentLoadedEventEnd) : null,
        loadMs: navigation ? round(navigation.loadEventEnd) : null,
        firstContentfulPaintMs: paint ? round(paint.startTime) : null,
        scripts: {
            n: scripts.length,
            decodedKb: round(scripts.reduce((sum, entry) => sum + entry.decodedBodySize, 0) / 1024),
            lastEndMs: round(Math.max(0, ...scripts.map((entry) => entry.responseEnd)))
        }
    };
}

export function snapshot(): Record<string, unknown> {
    const samples = current ?? freshWindow();
    const longFrames = samples.longFrames;
    return {
        measuredAt: new Date().toISOString(),
        durationMs: round(performance.now() - samples.startedAt),
        scene,
        environment: {
            userAgent: navigator.userAgent,
            devicePixelRatio: globalThis.devicePixelRatio,
            viewport: { width: globalThis.innerWidth, height: globalThis.innerHeight },
            hardwareConcurrency: navigator.hardwareConcurrency,
            visibility: document.visibilityState
        },
        units: { time: 'ms', heap: 'MiB' },
        page: pageStart(),
        frames: frameSummary(samples.frames),
        input: { toNextFrame: distribution(samples.inputs.map((sample) => sample.ms)), byType: byType(samples.inputs) },
        eventTiming: {
            thresholdMs: EVENT_TIMING_THRESHOLD_MS,
            all: distribution(samples.eventTimings.map((sample) => sample.ms)),
            byType: byType(samples.eventTimings)
        },
        longAnimationFrames: { n: longFrames.length, totalMs: round(longFrames.reduce((sum, ms) => sum + ms, 0)), maxMs: round(Math.max(0, ...longFrames)) },
        heap: heapSummary(samples.heap),
        mounts: mountCounts(),
        webgl: { terminalsHolding: webglTerminals().length, live: liveContexts().length, created: contextsCreated, lostInWindow: samples.contextsLost },
        dom: { elements: document.getElementsByTagName('*').length, canvases: document.getElementsByTagName('canvas').length }
    };
}

/* The snapshot, and a fresh window after it, so two takes never count a sample twice. */
export function take(): Record<string, unknown> {
    const taken = snapshot();
    startRecording();
    return taken;
}

/* Takes the context of the newest live ones away, as a lost GPU would; the budget is meant to hand them out again. */
function loseWebglContexts(count: number): number {
    const live = liveContexts().reverse().slice(0, count);
    for (const context of live) {
        context.getExtension('WEBGL_lose_context')?.loseContext();
    }
    return live.length;
}

watchWebglContexts();
Object.assign(globalThis, { __ruimteMeasure: { snapshot, take, startRecording, loseWebglContexts } });
