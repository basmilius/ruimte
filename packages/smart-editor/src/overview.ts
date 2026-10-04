export type OverviewKind = 'added' | 'modified' | 'deleted' | 'find' | 'find-current';

/* A stretch of the content, in the pixels the content is laid out in. */
export interface OverviewSpan {
    kind: OverviewKind;
    top: number;
    bottom: number;
}

export interface OverviewTick {
    kind: OverviewKind;
    y: number;
    height: number;
}

const MIN_TICK_HEIGHT = 3;

/*
 * The spans of the content as ticks in a track as tall as the view. A short document is not
 * stretched over the track, so a tick is where its line is. Ticks of one kind that touch are one.
 */
export function overviewTicks(spans: readonly OverviewSpan[], contentHeight: number, trackHeight: number): OverviewTick[] {
    if (trackHeight <= 0) {
        return [];
    }
    const scale = trackHeight / Math.max(contentHeight, trackHeight);
    const ticks = spans
        .map((span): OverviewTick => ({
            kind: span.kind,
            y: Math.round(span.top * scale),
            height: Math.max(MIN_TICK_HEIGHT, Math.round((span.bottom - span.top) * scale))
        }))
        .sort((left, right) => left.y - right.y);
    const merged: OverviewTick[] = [];
    const last = new Map<OverviewKind, OverviewTick>();
    for (const tick of ticks) {
        const before = last.get(tick.kind);
        if (before && tick.y <= before.y + before.height) {
            before.height = Math.max(before.height, tick.y + tick.height - before.y);
            continue;
        }
        const next = { ...tick };
        last.set(tick.kind, next);
        merged.push(next);
    }
    return merged;
}

/* Draws the ticks, the current find match last so it stays on top. */
export function paintOverview(container: HTMLElement, ticks: readonly OverviewTick[]): void {
    const document = container.ownerDocument;
    const order = (tick: OverviewTick): number => (tick.kind === 'find-current' ? 1 : 0);
    container.replaceChildren(
        ...[...ticks]
            .sort((left, right) => order(left) - order(right))
            .map((tick) => {
                const element = document.createElement('span');
                element.className = `se-tick se-tick-${tick.kind}`;
                element.style.top = `${tick.y}px`;
                element.style.height = `${tick.height}px`;
                return element;
            })
    );
}
