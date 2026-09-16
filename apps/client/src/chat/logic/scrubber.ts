import type { TimelineRow } from '@/chat/logic/timeline';

/*
 * The strip beside a thread with a tick per message a person sent, as numbers: which rows get a
 * tick, where the ticks go in the height the strip has, which message is being read, and which one
 * a pointer means. The component only draws what comes out of here.
 */

/* A message the person sent, or a turn the machine opened with the results of tasks. */
export type TickKind = 'person' | 'wake';

export interface ScrubberTick {
    id: string;
    /* The row of the timeline the tick jumps to. */
    rowIndex: number;
    kind: TickKind;
    text: string;
    createdAt: number;
}

/* With fewer messages than this the thread is short enough to scroll through, and the strip is noise. */
export const SCRUBBER_MIN_TICKS = 3;

/* Below this width a node needs every pixel for the thread itself. */
export const SCRUBBER_MIN_WIDTH_PX = 420;

export const TICK_HEIGHT_PX = 2;

const PITCH_PX = 8;
const MIN_PITCH_PX = 4;

/* The thread's content column in a view of its own (`.chat-column-content`). */
const CONTENT_MAX_WIDTH_PX = 768;
export const STRIP_WIDTH_PX = 24;
/* The padding the thread takes on its left while the strip stands there, `pl-8` in the timeline. */
const STRIP_GUTTER_PX = 32;
const THREAD_PADDING_PX = 16;
const STRIP_MARGIN_PX = 4;

const WIDTH_ACTIVE_PX = 16;
const WIDTH_NEAR_PX = 11;
const WIDTH_PERSON_PX = 8;
const WIDTH_WAKE_PX = 5;

export const ticksOf = (rows: readonly TimelineRow[]): ScrubberTick[] =>
    rows.flatMap((row, rowIndex): ScrubberTick[] => {
        if (row.kind === 'user') {
            // A message of only attachments still has a place in the thread; its names stand in for the text.
            const text = row.item.text !== '' ? row.item.text : (row.item.attachments ?? []).map((attachment) => attachment.name).join(', ');
            return [{ id: row.id, rowIndex, kind: 'person', text, createdAt: row.item.createdAt }];
        }
        // The other turns nobody asked for (a sub-agent that finished, the CLI going on) are no place to return to.
        if (row.kind === 'turn-start' && (row.turn.taskIds?.length ?? 0) > 0) {
            return [{ id: row.id, rowIndex, kind: 'wake', text: row.label, createdAt: row.turn.createdAt }];
        }
        return [];
    });

/* One drawn tick: a message, or a run of messages merged once the height has fewer pixels than they need. */
export interface TickSlot {
    first: number;
    last: number;
    kind: TickKind;
    /* The top of the tick inside the strip. */
    y: number;
}

export interface ScrubberLayout {
    top: number;
    pitch: number;
    count: number;
    slots: TickSlot[];
}

export const layoutTicks = (kinds: readonly TickKind[], height: number): ScrubberLayout => {
    const count = kinds.length;
    const room = Math.max(0, Math.floor(height));
    const slotCount = Math.min(count, Math.floor(room / MIN_PITCH_PX));
    if (slotCount === 0) {
        return { top: 0, pitch: MIN_PITCH_PX, count, slots: [] };
    }
    const pitch = Math.min(PITCH_PX, Math.floor(room / slotCount));
    const top = Math.floor((room - slotCount * pitch) / 2);
    const inset = Math.floor((pitch - TICK_HEIGHT_PX) / 2);
    const slots: TickSlot[] = [];
    for (let i = 0; i < slotCount; i++) {
        const first = Math.floor((i * count) / slotCount);
        const last = Math.floor(((i + 1) * count) / slotCount) - 1;
        // A merged tick is the person's as soon as one message in it is, since those are what the strip is for.
        const kind = kinds.slice(first, last + 1).includes('person') ? 'person' : 'wake';
        slots.push({ first, last, kind, y: top + i * pitch + inset });
    }
    return { top, pitch, count, slots };
};

/* The message under a height in the strip; inside a merged tick the height picks among its messages. */
export const messageAt = (layout: ScrubberLayout, y: number): number | null => {
    const { slots, top, pitch } = layout;
    if (slots.length === 0) {
        return null;
    }
    const offset = y - top;
    const index = Math.min(slots.length - 1, Math.max(0, Math.floor(offset / pitch)));
    const slot = slots[index]!;
    const fraction = Math.min(1, Math.max(0, (offset - index * pitch) / pitch));
    return slot.first + Math.min(slot.last - slot.first, Math.floor(fraction * (slot.last - slot.first + 1)));
};

export const slotOf = (layout: ScrubberLayout, message: number): number | null => {
    const { slots } = layout;
    let low = 0;
    let high = slots.length - 1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        const slot = slots[middle]!;
        if (message < slot.first) {
            high = middle - 1;
        } else if (message > slot.last) {
            low = middle + 1;
        } else {
            return middle;
        }
    }
    return null;
};

/* Longer the closer a tick is to the message being read, the way a dock magnifies, but only one step out. */
export const tickWidth = (kind: TickKind, distance: number | null): number => {
    if (distance === 0) {
        return WIDTH_ACTIVE_PX;
    }
    if (distance === 1) {
        return kind === 'person' ? WIDTH_NEAR_PX : WIDTH_PERSON_PX;
    }
    return kind === 'person' ? WIDTH_PERSON_PX : WIDTH_WAKE_PX;
};

/* The last index whose start lies at or above a line, or -1. The starts only grow. */
const lastAtOrAbove = (starts: readonly number[], line: number): number => {
    let low = 0;
    let high = starts.length - 1;
    let found = -1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (starts[middle]! <= line) {
            found = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return found;
};

export interface ReadingPosition {
    /* Where each message's row starts in the thread, in the virtualizer's measurements. */
    starts: readonly number[];
    scrollTop: number;
    /* The height of the thread a person can read, without what the composer covers. */
    visibleHeight: number;
    atEnd: boolean;
}

/*
 * The message being read is the last one that starts above a line a quarter down the thread: a
 * question that just scrolled out at the top is still what the answer on screen belongs to. At the
 * end the line drops to the bottom, or a short last exchange would never light its own tick.
 */
export const messageInView = ({ starts, scrollTop, visibleHeight, atEnd }: ReadingPosition): number | null => {
    if (starts.length === 0) {
        return null;
    }
    const line = scrollTop + (atEnd ? visibleHeight : Math.floor(visibleHeight / 4));
    return Math.max(0, lastAtOrAbove(starts, line));
};

/*
 * The message a step back or forward lands on, among the ones `eligible` allows. A jump puts a
 * message's start at the top, so back from there is the one before it, and back from the middle of
 * a long answer is the question it belongs to. A pixel of slack absorbs rounding in the scroller.
 */
export const stepMessage = (starts: readonly number[], eligible: (index: number) => boolean, scrollTop: number, direction: -1 | 1): number | null => {
    if (direction === -1) {
        for (let i = lastAtOrAbove(starts, scrollTop - 1.5); i >= 0; i--) {
            if (eligible(i)) {
                return i;
            }
        }
        return null;
    }
    for (let i = lastAtOrAbove(starts, scrollTop + 1) + 1; i < starts.length; i++) {
        if (eligible(i)) {
            return i;
        }
    }
    return null;
};

/* Where the strip stands: at the thread's edge in a node, beside the centered column in a view of its own. */
export const stripLeft = (width: number, column: boolean): number => {
    if (!column) {
        return STRIP_MARGIN_PX;
    }
    const free = Math.floor((width - STRIP_GUTTER_PX - THREAD_PADDING_PX - CONTENT_MAX_WIDTH_PX) / 2);
    return Math.max(STRIP_MARGIN_PX, STRIP_GUTTER_PX + free - STRIP_WIDTH_PX - STRIP_MARGIN_PX);
};
