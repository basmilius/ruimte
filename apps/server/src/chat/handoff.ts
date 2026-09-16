import type { ChatItem } from '@ruimte/contracts';
import { renderTranscript } from '../context/context-store.ts';

/*
 * How much of the conversation a new CLI reads as text before its first prompt. It is the dearest
 * part of that prompt, so it is a constant here and not a setting; the rest is one read away.
 */
export const HANDOFF_BUDGET_BYTES = 12 * 1024;

const encoder = new TextEncoder();

export interface HandoffMeta {
    /* The name of the CLI the conversation ran with. */
    fromName: string;
    originalId: string;
    originalTitle: string;
    /* Whether the original is a chat view of its own rather than a node on a canvas. */
    view: boolean;
    turnNumber: number;
    totalTurns: number;
    at: number;
    cwd: string;
    /* The worktree the fork works in, or null when it shares the original's folder. */
    worktree: { branch: string; afterTurn: boolean } | null;
}

/* A moment as every machine writes it, so the text does not depend on the daemon's locale. */
const moment = (at: number): string => `${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/* The copied items per turn, oldest first; what belongs to no turn is left out, since the daemon wrote it. */
const turnsOf = (items: readonly ChatItem[]): ChatItem[][] => {
    const order: string[] = [];
    const byTurn = new Map<string, ChatItem[]>();
    for (const item of items) {
        if (item.turnId === null) {
            continue;
        }
        let group = byTurn.get(item.turnId);
        if (!group) {
            group = [];
            byTurn.set(item.turnId, group);
            order.push(item.turnId);
        }
        group.push(item);
    }
    return order.map((turnId) => byTurn.get(turnId)!);
};

/*
 * What a CLI that takes over a conversation hears first: where it came from, how to read all of it,
 * and its last whole turns as text, added from the newest back until the budget is spent. The last
 * turn always goes along, however long it is, since a handoff without it has nothing to go on from.
 */
export const handoffText = (items: readonly ChatItem[], meta: HandoffMeta, budget = HANDOFF_BUDGET_BYTES): { text: string; turns: number; all: boolean } => {
    const rendered = turnsOf(items)
        .map((turn) => renderTranscript(turn))
        .filter((text) => text !== '');
    const kept: string[] = [];
    let bytes = 0;
    for (const text of rendered.toReversed()) {
        const size = encoder.encode(text).length + 2;
        if (kept.length > 0 && bytes + size > budget) {
            break;
        }
        kept.unshift(text);
        bytes += size;
    }
    const where = meta.view ? 'view' : 'node';
    const folder =
        meta.worktree === null
            ? `${meta.cwd}, the same folder the original works in, so its files may be newer than that turn.`
            : `${meta.cwd} (a git worktree on branch ${meta.worktree.branch}, ${meta.worktree.afterTurn ? 'with the files as they were after that turn' : 'from the current HEAD'}).`;
    const part = kept.length === rendered.length ? 'all of it' : `its last ${kept.length === 1 ? 'turn' : `${kept.length} turns`}`;
    const text = [
        `Ruimte: you take over a conversation that ran with ${meta.fromName} in ${where} ${meta.originalId} ("${meta.originalTitle}") on this machine, forked after its turn ${meta.turnNumber} of ${meta.totalTurns} on ${moment(meta.at)}.`,
        `Folder: ${folder}`,
        `The original is readable with: ruimte-context read ${meta.originalId} (add --tail 200 for the last part); only its turns up to turn ${meta.turnNumber} happened here. What follows is ${part}, as text. The tool lines are what ${meta.fromName} ran, not you, so check the files before you assume.`,
        '---',
        kept.join('\n\n'),
        '---',
        "Continue from here. The person's next message follows."
    ].join('\n');
    return { text, turns: kept.length, all: kept.length === rendered.length };
};
