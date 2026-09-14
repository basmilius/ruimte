import type { Point, Rect } from './layout.ts';

export const TRACK_GAP = 12;
/* Space between the lane of labels and the first track. */
const LANE_GAP = 12;
/* Space between two labels side by side in a lane. */
const LABEL_GAP = 8;
/* How far a label keeps from the line it belongs to. */
const LABEL_OFFSET = 4;
export const MIN_CHANNEL = 64;
/* Two horizontal lines closer than this read as one. */
const COLLINEAR = 4;
/* Two vertical ranges closer than this need tracks of their own. */
const RANGE_CLEARANCE = 8;

/* A hop through a channel: it leaves at `ya` and arrives at `yb`, both across the flow. */
export interface ChannelHop {
    hop: number;
    ya: number;
    yb: number;
}

export interface ChannelLabel {
    edge: number;
    /* The hop it belongs to, whose own line never counts against it. */
    hop: number;
    /* The line it sits beside. */
    y: number;
    along: number;
    across: number;
}

export interface ChannelInput {
    /* Where the channel begins along the flow, right after the widest box of its layer. */
    start: number;
    /* Room kept free at the start and the end, for a group's border and an arrowhead. */
    clearBefore: number;
    clearAfter: number;
    hops: ChannelHop[];
    labels: ChannelLabel[];
    /* Stretches across the flow no label may cover, over the whole channel: group borders and group labels. */
    obstacles: { y: number; h: number }[];
}

export interface ChannelResult {
    width: number;
    trackX: Map<number, number>;
    labels: Map<number, Rect>;
}

const overlaps = (left: Rect, right: Rect): boolean =>
    left.x < right.x + right.w && right.x < left.x + left.w && left.y < right.y + right.h && right.y < left.y + left.h;

const inflate = (rect: Rect, by: number): Rect => ({ x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 });

/*
 * How badly two orthogonal polylines get in each other's way: a crossing counts once, a stretch where
 * they run on top of each other counts four times, since that is the one a reader cannot follow.
 */
export const conflictsOf = (left: readonly Point[], right: readonly Point[]): number => {
    let total = 0;
    for (let i = 1; i < left.length; i++) {
        const a0 = left[i - 1]!;
        const a1 = left[i]!;
        for (let j = 1; j < right.length; j++) {
            const b0 = right[j - 1]!;
            const b1 = right[j]!;
            const aFlat = a0.y === a1.y;
            const bFlat = b0.y === b1.y;
            if (aFlat !== bFlat) {
                const [h0, h1, v0, v1] = aFlat ? [a0, a1, b0, b1] : [b0, b1, a0, a1];
                if (v0.x > Math.min(h0.x, h1.x) && v0.x < Math.max(h0.x, h1.x) && h0.y > Math.min(v0.y, v1.y) && h0.y < Math.max(v0.y, v1.y)) {
                    total += 1;
                }
                continue;
            }
            const [along0, along1, other0, other1, gap] = aFlat
                ? [Math.min(a0.x, a1.x), Math.max(a0.x, a1.x), Math.min(b0.x, b1.x), Math.max(b0.x, b1.x), Math.abs(a0.y - b0.y)]
                : [Math.min(a0.y, a1.y), Math.max(a0.y, a1.y), Math.min(b0.y, b1.y), Math.max(b0.y, b1.y), Math.abs(a0.x - b0.x)];
            if (gap < COLLINEAR && Math.min(along1, other1) > Math.max(along0, other0)) {
                total += 4;
            }
        }
    }
    return total;
};

/* A hop drawn on a track in a channel of unit tracks, only to compare two orders of the tracks. */
const sketchOf = (hop: ChannelHop, track: number): Point[] => [
    { x: 0, y: hop.ya },
    { x: track * TRACK_GAP, y: hop.ya },
    { x: track * TRACK_GAP, y: hop.yb },
    { x: TRACK_GAP * 3, y: hop.yb }
];

/*
 * The inside of one channel between two layers. Every hop that changes place across the flow gets a
 * vertical track of its own where its range meets another's, in the order that crosses the fewest
 * lines; labels go in a lane before the tracks, beside the line their hop leaves on, and the lane
 * grows a column where two labels would otherwise cover each other.
 */
export const routeChannel = (input: ChannelInput): ChannelResult => {
    const vertical = input.hops.filter((hop) => hop.ya !== hop.yb);
    const count = vertical.length;
    const near = (left: ChannelHop, right: ChannelHop): boolean =>
        Math.min(Math.max(left.ya, left.yb), Math.max(right.ya, right.yb)) + RANGE_CLEARANCE >
        Math.max(Math.min(left.ya, left.yb), Math.min(right.ya, right.yb));
    // cost[i * count + j]: how much i and j conflict when i's track is left of j's.
    const cost = new Array<number>(count * count).fill(0);
    for (let i = 0; i < count; i++) {
        for (let j = 0; j < count; j++) {
            if (i !== j && near(vertical[i]!, vertical[j]!)) {
                cost[i * count + j] = conflictsOf(sketchOf(vertical[i]!, 1), sketchOf(vertical[j]!, 2));
            }
        }
    }
    const score = vertical.map((_, i) => {
        let sum = 0;
        for (let j = 0; j < count; j++) {
            sum += cost[i * count + j]! - cost[j * count + i]!;
        }
        return sum;
    });
    const order = vertical.map((_, i) => i).sort((left, right) => score[left]! - score[right]! || left - right);
    for (let pass = 0; pass < count; pass++) {
        let swapped = false;
        for (let p = 0; p + 1 < count; p++) {
            const left = order[p]!;
            const right = order[p + 1]!;
            if (cost[right * count + left]! < cost[left * count + right]!) {
                order[p] = right;
                order[p + 1] = left;
                swapped = true;
            }
        }
        if (!swapped) {
            break;
        }
    }
    const track = new Array<number>(count).fill(0);
    let tracks = 0;
    order.forEach((index, p) => {
        let at = 0;
        for (let q = 0; q < p; q++) {
            const other = order[q]!;
            if (near(vertical[other]!, vertical[index]!)) {
                at = Math.max(at, track[other]! + 1);
            }
        }
        track[index] = at;
        tracks = Math.max(tracks, at + 1);
    });

    // Labels are placed in two frames before the width is known: the lane before the tracks, and the tracks with the lane after them.
    const slotAlong = input.labels.reduce((widest, label) => Math.max(widest, label.along), 0);
    const slotStep = slotAlong + LABEL_GAP;
    const tracksSpan = Math.max(0, tracks - 1) * TRACK_GAP;
    const afterStart = tracks > 0 ? tracksSpan + LANE_GAP : 0;
    const trackOf = new Map<number, number>();
    vertical.forEach((hop, index) => trackOf.set(hop.hop, track[index]! * TRACK_GAP));
    type Zone = 'before' | 'middle';
    const placed: { zone: Zone; rect: Rect }[] = [];
    const chosen = new Map<number, { zone: Zone; rect: Rect }>();
    let slotsBefore = input.labels.length > 0 ? 1 : 0;
    let slotsAfter = 0;

    const touches = (x0: number, x1: number, y0: number, y1: number, rect: Rect): boolean =>
        x1 >= rect.x - 3 && x0 <= rect.x + rect.w + 3 && y1 >= rect.y - 3 && y0 <= rect.y + rect.h + 3;
    const blocked = (zone: Zone, rect: Rect): boolean =>
        placed.some((other) => other.zone === zone && overlaps(inflate(other.rect, 4), rect)) ||
        input.obstacles.some((obstacle) => obstacle.y < rect.y + rect.h && rect.y < obstacle.y + obstacle.h);
    const onLine = (zone: Zone, rect: Rect, label: ChannelLabel): boolean =>
        input.hops.some((hop) => {
            if (zone === 'before') {
                return hop.hop !== label.hop && hop.ya > rect.y - 3 && hop.ya < rect.y + rect.h + 3;
            }
            const own = hop.hop === label.hop;
            const at = trackOf.get(hop.hop);
            if (at === undefined) {
                return !own && touches(-Infinity, Infinity, hop.ya, hop.ya, rect);
            }
            return (
                (!own && touches(-Infinity, at, hop.ya, hop.ya, rect)) ||
                (!own && touches(at, at, Math.min(hop.ya, hop.yb), Math.max(hop.ya, hop.yb), rect)) ||
                touches(at, Infinity, hop.yb, hop.yb, rect)
            );
        });
    const inLane = (label: ChannelLabel, x: number, y: number, above: boolean): Rect => ({
        x: x + Math.floor((slotAlong - label.along) / 2),
        y: above ? y - LABEL_OFFSET - label.across : y + LABEL_OFFSET,
        w: label.along,
        h: label.across
    });

    for (const label of input.labels) {
        const hop = input.hops.find((candidate) => candidate.hop === label.hop);
        const before = (slot: number) => [true, false].map((above) => ({ zone: 'before' as Zone, rect: inLane(label, slot * slotStep, label.y, above) }));
        const after = (slot: number) =>
            hop ? [true, false].map((above) => ({ zone: 'middle' as Zone, rect: inLane(label, afterStart + slot * slotStep, hop.yb, above) })) : [];
        const at = trackOf.get(label.hop);
        const beside =
            hop && at !== undefined
                ? [
                      {
                          zone: 'middle' as Zone,
                          rect: { x: at + LABEL_OFFSET, y: Math.round((hop.ya + hop.yb) / 2 - label.across / 2), w: label.along, h: label.across }
                      }
                  ]
                : [];
        const existing = [
            ...Array.from({ length: slotsBefore }, (_, slot) => before(slot)).flat(),
            ...beside,
            ...Array.from({ length: slotsAfter }, (_, slot) => after(slot)).flat()
        ];
        const clear = (candidate: { zone: Zone; rect: Rect }): boolean =>
            !blocked(candidate.zone, candidate.rect) && !onLine(candidate.zone, candidate.rect, label);
        let choice = existing.find(clear);
        if (!choice) {
            choice = before(slotsBefore).find(clear);
            if (choice) {
                slotsBefore += 1;
            }
        }
        if (!choice) {
            choice = after(slotsAfter).find(clear);
            if (choice) {
                slotsAfter += 1;
            }
        }
        // A place beside no line may not exist, since every line in a lane runs its whole width; a free place is enough.
        choice ??= existing.find((candidate) => !blocked(candidate.zone, candidate.rect));
        if (!choice) {
            choice = before(slotsBefore)[0]!;
            slotsBefore += 1;
        }
        placed.push(choice);
        chosen.set(label.edge, choice);
    }

    // Only what was put in it: a channel whose labels all found room beside their tracks keeps no lane.
    const laneWidth = Math.max(0, ...placed.filter((entry) => entry.zone === 'before').map((entry) => entry.rect.x + entry.rect.w));
    const middleLabels = placed.filter((entry) => entry.zone === 'middle');
    const hasMiddle = tracks > 0 || middleLabels.length > 0;
    const middleWidth = Math.max(
        tracksSpan,
        slotsAfter > 0 ? afterStart + slotsAfter * slotStep - LABEL_GAP : 0,
        ...middleLabels.map((entry) => entry.rect.x + entry.rect.w)
    );
    const laneGap = laneWidth > 0 && hasMiddle ? LANE_GAP : 0;
    const needed = input.clearBefore + laneWidth + laneGap + (hasMiddle ? middleWidth : 0) + input.clearAfter;
    const width = Math.max(MIN_CHANNEL, needed);
    const laneStart = input.start + input.clearBefore;
    const middleStart = laneStart + laneWidth + laneGap + Math.floor((width - needed) / 2);
    const trackX = new Map<number, number>();
    trackOf.forEach((x, hop) => trackX.set(hop, middleStart + x));
    const labels = new Map<number, Rect>();
    chosen.forEach((entry, edge) => {
        labels.set(edge, { ...entry.rect, x: entry.rect.x + (entry.zone === 'before' ? laneStart : middleStart) });
    });
    return { width, trackX, labels };
};
