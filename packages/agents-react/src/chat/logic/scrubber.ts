import type { ChatBookmark } from '@ruimte/agent-contracts';
import type { TimelineRow } from './timeline';

/*
 * The strip at the left edge of a chat view with a tick per message a person sent, as numbers: which
 * rows get a tick, where the ticks go in the height the strip has, which messages are on screen, and
 * which one a pointer means. The component only draws what comes out of here.
 */

/* A message the person sent, a turn the machine opened with the results of tasks, or any other message with a bookmark on it. */
export type TickKind = 'person' | 'wake' | 'bookmark';

export interface ScrubberTick {
    id: string;
    /* The row of the timeline the tick jumps to. */
    rowIndex: number;
    kind: TickKind;
    text: string;
    createdAt: number;
    /* The turn the message opened, which is the turn a fork from the card goes on after. */
    turnId: string | null;
    bookmark: ChatBookmark | null;
}

/* With fewer messages than this the thread is short enough to scroll through, and the strip is noise. */
export const SCRUBBER_MIN_TICKS = 3;

export const TICK_HEIGHT_PX = 2;

const PITCH_PX = 8;
const MIN_PITCH_PX = 4;

/* The thread's content column in a view of its own (`.chat-column-content`) and the scroller's padding around it (`px-4`). */
const CONTENT_MAX_WIDTH_PX = 768;
const THREAD_PADDING_PX = 16;
export const STRIP_WIDTH_PX = 24;
/* The strip's distance from the view's left edge, and the air it keeps between itself and the thread's text. */
export const STRIP_INSET_PX = 8;
const STRIP_CLEARANCE_PX = STRIP_INSET_PX + STRIP_WIDTH_PX + STRIP_INSET_PX;

const WIDTH_HOVERED_PX = 16;
const WIDTH_NEAR_PERSON_PX = 12;
const WIDTH_NEAR_WAKE_PX = 8;
const WIDTH_PERSON_PX = 8;
const WIDTH_WAKE_PX = 5;

/* `marks` is what `bookmarkRows` answers: the bookmark drawn at a row, by row id. */
export const ticksOf = (rows: readonly TimelineRow[], marks: ReadonlyMap<string, ChatBookmark> = new Map()): ScrubberTick[] =>
    rows.flatMap((row, rowIndex): ScrubberTick[] => {
        const bookmark = marks.get(row.id) ?? null;
        if (row.kind === 'user') {
            // A message of only attachments still has a place in the thread; its names stand in for the text.
            const text = row.item.text !== '' ? row.item.text : (row.item.attachments ?? []).map((attachment) => attachment.name).join(', ');
            return [{ id: row.id, rowIndex, kind: 'person', text, createdAt: row.item.createdAt, turnId: row.item.turnId, bookmark }];
        }
        // The other turns nobody asked for (a sub-agent that finished, the CLI going on) are no place to return to.
        if (row.kind === 'turn-start' && ((row.turn.taskIds?.length ?? 0) > 0 || (row.turn.messageFrom?.length ?? 0) > 0)) {
            return [{ id: row.id, rowIndex, kind: 'wake', text: row.label, createdAt: row.turn.createdAt, turnId: row.turn.id, bookmark: null }];
        }
        if (bookmark === null) {
            return [];
        }
        if (row.kind === 'assistant') {
            return [{ id: row.id, rowIndex, kind: 'bookmark', text: row.item.text, createdAt: row.item.createdAt, turnId: row.item.turnId, bookmark }];
        }
        // The fold of a turn a marked reply is hidden in; the card reads the start the bookmark kept.
        const turnId = row.kind === 'turn-fold' ? row.turn.id : null;
        return [{ id: row.id, rowIndex, kind: 'bookmark', text: bookmark.excerpt, createdAt: bookmark.createdAt, turnId, bookmark }];
    });

/* One drawn tick: a message, or a run of messages merged once the height has fewer pixels than they need. */
export interface TickSlot {
    first: number;
    last: number;
    kind: TickKind;
    /* Whether a message under it has a bookmark, which draws it in the accent. */
    marked: boolean;
    /* Whether a find hit falls under it, which puts a mark of the find's own color beside it. */
    found: boolean;
    /* The top of the tick inside the strip. */
    y: number;
}

export interface ScrubberLayout {
    top: number;
    pitch: number;
    count: number;
    slots: TickSlot[];
}

/* `marked` and `found` say per message whether it has a bookmark and whether a find hit falls under it; absent, none has. */
export const layoutTicks = (kinds: readonly TickKind[], height: number, marked: readonly boolean[] = [], found: readonly boolean[] = []): ScrubberLayout => {
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
        const run = kinds.slice(first, last + 1);
        const kind = run.includes('person') ? 'person' : run.includes('bookmark') ? 'bookmark' : 'wake';
        slots.push({
            first,
            last,
            kind,
            marked: marked.slice(first, last + 1).includes(true),
            found: found.slice(first, last + 1).includes(true),
            y: top + i * pitch + inset
        });
    }
    return { top, pitch, count, slots };
};

/*
 * The tick whose stretch of the thread a row falls in: a tick stands for its row and every row up to
 * the next tick's, and a row above the first tick counts under the first. Null without ticks.
 */
export const tickOfRow = (ticks: readonly ScrubberTick[], rowIndex: number): number | null => {
    if (ticks.length === 0) {
        return null;
    }
    let low = 0;
    let high = ticks.length - 1;
    let found = 0;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (ticks[middle]!.rowIndex <= rowIndex) {
            found = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return found;
};

/* Per tick, whether any of the rows has a find hit in its stretch. */
export const ticksWithHits = (ticks: readonly ScrubberTick[], hitRows: readonly number[]): boolean[] => {
    const found = ticks.map(() => false);
    for (const row of hitRows) {
        const tick = tickOfRow(ticks, row);
        if (tick !== null) {
            found[tick] = true;
        }
    }
    return found;
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

/*
 * At rest every tick of a kind is as long as the next, so length never competes with the brightness
 * that says what is on screen. Only a pointer on the strip magnifies, the way a dock does, one step out.
 */
export const tickWidth = (kind: TickKind, distanceFromPointer: number | null): number => {
    if (distanceFromPointer === 0) {
        return WIDTH_HOVERED_PX;
    }
    if (distanceFromPointer === 1) {
        return kind === 'wake' ? WIDTH_NEAR_WAKE_PX : WIDTH_NEAR_PERSON_PX;
    }
    return kind === 'wake' ? WIDTH_WAKE_PX : WIDTH_PERSON_PX;
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
}

export interface MessageRange {
    first: number;
    last: number;
}

/*
 * The messages on screen. A message counts from its own start to the start of the next one, so the
 * question whose answer fills the screen is in view even after it scrolled out at the top.
 */
export const messagesInView = ({ starts, scrollTop, visibleHeight }: ReadingPosition): MessageRange | null => {
    const bottom = scrollTop + visibleHeight;
    if (starts.length === 0 || visibleHeight <= 0 || starts[0]! >= bottom) {
        return null;
    }
    const first = Math.max(0, lastAtOrAbove(starts, scrollTop));
    let last = lastAtOrAbove(starts, bottom);
    // A row that starts on the very last line has not a pixel on screen yet.
    if (starts[last]! >= bottom) {
        last--;
    }
    return { first, last: Math.max(first, last) };
};

/* Whether a drawn tick covers any of the messages on screen. */
export const slotInView = (slot: TickSlot, range: MessageRange | null): boolean => range !== null && slot.last >= range.first && slot.first <= range.last;

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

/*
 * The left padding of the thread in a view that draws the strip at its left edge. A wide view keeps
 * the usual padding, since its centered column already clears the strip; a narrower one pads until
 * the column's text starts clear of it, so nothing is ever drawn under the strip.
 */
export const threadPaddingLeft = (width: number, strip: boolean): number => {
    if (!strip) {
        return THREAD_PADDING_PX;
    }
    // The column's margin is half of what the padding leaves, so the padding counts the clearance twice.
    const padding = 2 * STRIP_CLEARANCE_PX + CONTENT_MAX_WIDTH_PX + THREAD_PADDING_PX - Math.floor(width);
    return Math.min(STRIP_CLEARANCE_PX, Math.max(THREAD_PADDING_PX, padding));
};
