/*
 * Metrics gathered for a quarter of an hour and sent as a few items. The SDK sends every value as an item of its
 * own, five seconds after the first, so a long-running process that measures as it goes keeps a request going out
 * all day. A window keeps per name and attributes: a counter's sum, a gauge's last value, and of a distribution
 * the median and the maximum, which is what a slow quarter shows in. The percentiles across all measurements are
 * given up for that.
 */

export const METRIC_WINDOW_MS = 15 * 60_000;

// What one group keeps of a distribution; past it only the maximum still moves, so memory stays bounded.
const MAX_VALUES = 2_000;

export type MetricKind = 'count' | 'gauge' | 'distribution';

export interface MetricItem {
    readonly kind: MetricKind;
    readonly name: string;
    readonly value: number;
    readonly unit?: string;
    readonly attributes?: Readonly<Record<string, string>>;
}

/* Where a drained window goes: the SDK's `metrics`, or a fake in a test. */
export interface MetricSink {
    count(name: string, value: number, options: { attributes?: Record<string, string> }): void;
    gauge(name: string, value: number, options: { unit?: string; attributes?: Record<string, string> }): void;
    distribution(name: string, value: number, options: { unit?: string; attributes?: Record<string, string> }): void;
}

interface Group {
    readonly kind: MetricKind;
    readonly name: string;
    readonly unit?: string;
    readonly attributes: Record<string, string>;
    readonly values: number[];
    sum: number;
    last: number;
    max: number;
}

function keyOf(item: MetricItem): string {
    const attributes = Object.entries(item.attributes ?? {}).sort(([left], [right]) => left.localeCompare(right));

    return JSON.stringify([item.kind, item.name, item.unit ?? null, attributes]);
}

function median(values: readonly number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

export class MetricWindow {
    private groups = new Map<string, Group>();

    record(item: MetricItem): void {
        const key = keyOf(item);
        const group = this.groups.get(key);

        if (group === undefined) {
            this.groups.set(key, {
                kind: item.kind,
                name: item.name,
                ...(item.unit === undefined ? {} : { unit: item.unit }),
                attributes: { ...item.attributes },
                values: [item.value],
                sum: item.value,
                last: item.value,
                max: item.value
            });

            return;
        }

        group.sum += item.value;
        group.last = item.value;
        group.max = Math.max(group.max, item.value);

        if (group.values.length < MAX_VALUES) {
            group.values.push(item.value);
        }
    }

    drain(): MetricItem[] {
        const groups = [...this.groups.values()];
        this.groups = new Map();

        return groups.flatMap((group): MetricItem[] => {
            const base = { name: group.name, ...(group.unit === undefined ? {} : { unit: group.unit }), attributes: group.attributes };

            if (group.kind === 'count') {
                return [{ ...base, kind: 'count', value: group.sum }];
            }

            if (group.kind === 'gauge') {
                return [{ ...base, kind: 'gauge', value: group.last }];
            }

            if (group.values.length === 1) {
                return [{ ...base, kind: 'distribution', value: group.max }];
            }

            return [
                { ...base, kind: 'distribution', value: median(group.values) },
                { ...base, kind: 'distribution', value: group.max }
            ];
        });
    }
}

export function sendMetrics(sink: MetricSink, items: readonly MetricItem[]): void {
    for (const item of items) {
        const options = {
            ...(item.unit === undefined ? {} : { unit: item.unit }),
            ...(item.attributes === undefined ? {} : { attributes: { ...item.attributes } })
        };

        if (item.kind === 'count') {
            sink.count(item.name, item.value, options);
        } else if (item.kind === 'gauge') {
            sink.gauge(item.name, item.value, options);
        } else {
            sink.distribution(item.name, item.value, options);
        }
    }
}

export interface QuarterMeter {
    record(item: MetricItem): void;
    /* Sends what the window holds now, such as when the process stops or the page goes away. */
    flush(): void;
    stop(): void;
}

/*
 * A window that sends itself every `everyMs`. The timer is unref'd where the runtime has that, so it never keeps
 * a stopping process alive; a test passes its own `schedule`.
 */
export function startQuarterMeter(
    sink: MetricSink,
    options: { everyMs?: number; schedule?: (run: () => void, everyMs: number) => () => void } = {}
): QuarterMeter {
    const window = new MetricWindow();
    const flush = (): void => sendMetrics(sink, window.drain());

    const schedule =
        options.schedule ??
        ((run: () => void, everyMs: number) => {
            const timer = setInterval(run, everyMs) as unknown as { unref?: () => void };
            timer.unref?.();

            return () => clearInterval(timer as unknown as ReturnType<typeof setInterval>);
        });

    const cancel = schedule(flush, options.everyMs ?? METRIC_WINDOW_MS);

    return {
        record: (item) => window.record(item),
        flush,
        stop: () => {
            cancel();
            flush();
        }
    };
}
