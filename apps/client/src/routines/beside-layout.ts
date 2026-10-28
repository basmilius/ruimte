import type { RoutineRun } from '@ruimte/contracts';
import { COLUMN_W, GUTTER, LINE_H, OPEN_H, OPEN_MIN_H, STACK_GAP } from '@/canvas/beside-metrics';
import { GRID, snapToGrid, type Rect } from '@/canvas/math';
import type { CardSize } from '@/routines/output-size';

/* What a person or the open run's thread set beside the layout's own sizes; null keeps the layout's. */
interface BesideSizes {
    output?: CardSize | null;
    runsWidth?: number | null;
    /* Each run's header and thread as last measured open, kept between the minimum and maximum; one not measured yet starts at the minimum. */
    openHeights?: Readonly<Record<string, number>>;
    /* Only the Output, in the first column at the newest version, with its line from the node. */
    runsHidden?: boolean;
}

/* The run cards beside a routine node, the open one included; the rest wait behind the line under them. */
const BESIDE_RUNS = 4;

const OLDER_H = 28;

export type BesideCard =
    | { kind: 'run'; key: string; run: RoutineRun; open: boolean; rect: Rect }
    | { kind: 'older'; key: string; count: number; rect: Rect }
    | {
          kind: 'output';
          key: string;
          artifactId: string;
          /* The version it shows; null when no run kept one, which shows the artifact's newest. */
          versionId: string | null;
          /* The open run kept no version, so it shows this run's instead, or the artifact's newest when null. */
          fallback: { run: RoutineRun | null } | null;
          /* The run card its line comes from, or null for the routine node itself. */
          from: string | null;
          rect: Rect;
      };

/* The run a routine node opens beside it by itself: the newest one that ran, or the newest at all. */
function defaultOpenRun(runs: readonly RoutineRun[]): string | null {
    return (runs.find((run) => run.state !== 'skipped') ?? runs[0])?.runId ?? null;
}

/*
 * Where the cards beside a routine node go, in world units: a column to its right with its newest runs,
 * at most one of them open, and the count of the older ones; and a column right of that with its
 * Output at the version of the open run, or the newest version with none open. Sizes are known up
 * front, or measured once (the open run's thread), so the lines and the culling place every card
 * without measuring the rest. `openRunId` is undefined until a person picked, which opens the
 * default, and null once they closed them all.
 */
export function besideLayout(
    node: Rect,
    runs: readonly RoutineRun[],
    openRunId: string | null | undefined,
    artifactId: string | undefined,
    sizes: BesideSizes = {}
): BesideCard[] {
    const { output: outputSize = null, runsWidth = null, openHeights = {}, runsHidden = false } = sizes;
    const x = node.x + node.w + GUTTER;
    const columnW = snapToGrid(runsWidth ?? COLUMN_W);
    const shown = runsHidden ? [] : runs.slice(0, BESIDE_RUNS);
    const open = openRunId === null ? null : shown.some((run) => run.runId === openRunId) ? openRunId : defaultOpenRun(shown);
    const measured = open === null || open === undefined ? undefined : openHeights[open];
    const openH = measured === undefined ? OPEN_MIN_H : Math.min(OPEN_H, Math.max(OPEN_MIN_H, Math.ceil(measured / GRID) * GRID));
    const cards: BesideCard[] = [];
    let y = node.y;
    for (const run of shown) {
        const isOpen = run.runId === open;
        const h = isOpen ? openH : LINE_H;
        cards.push({ kind: 'run', key: `run:${run.runId}`, run, open: isOpen, rect: { x, y, w: columnW, h } });
        y += h + STACK_GAP;
    }
    if (!runsHidden && runs.length > shown.length) {
        cards.push({ kind: 'older', key: 'older', count: runs.length - shown.length, rect: { x, y, w: columnW, h: OLDER_H } });
    }
    if (artifactId === undefined) {
        return cards;
    }
    const openRun = shown.find((run) => run.runId === open);
    const latest = runs.find((run) => run.versionId !== undefined) ?? null;
    const source = openRun?.versionId !== undefined ? openRun : latest;
    // The line comes from the open run, and with none open from the run whose version it shows.
    const from = cards.find((card) => card.kind === 'run' && card.run === (openRun ?? source));
    cards.push({
        kind: 'output',
        key: 'output',
        artifactId,
        versionId: source?.versionId ?? null,
        fallback: openRun !== undefined && openRun.versionId === undefined ? { run: latest } : null,
        from: from?.key ?? null,
        // Top aligned with the node whichever run is open, so the version stays put while a person moves through the runs.
        rect: { x: runsHidden ? x : x + columnW + GUTTER, y: node.y, w: snapToGrid(outputSize?.w ?? COLUMN_W), h: snapToGrid(outputSize?.h ?? OPEN_H) }
    });
    return cards;
}
