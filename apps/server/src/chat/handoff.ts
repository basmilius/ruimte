import type { ChatItem } from '@ruimte/contracts';
import { renderTranscript } from '../context/context-store.ts';

/*
 * How much of the conversation a new CLI reads as text before its first prompt. It is the dearest
 * part of that prompt, so it is computed here and never a setting; the rest is one read away.
 * A larger window takes a share of itself, between the floor and the ceiling.
 */
export const HANDOFF_FLOOR_BYTES = 12 * 1024;
export const HANDOFF_CEILING_BYTES = 64 * 1024;
const HANDOFF_WINDOW_SHARE = 0.025;
// A rough average for English text and code; the budget only needs the order of magnitude.
const BYTES_PER_TOKEN = 4;

/* The handoff budget for a model with this context window in tokens; null when its window is unknown. */
export function handoffBudget(contextWindow: number | null | undefined): number {
    if (contextWindow === null || contextWindow === undefined || !Number.isFinite(contextWindow) || contextWindow <= 0) {
        return HANDOFF_FLOOR_BYTES;
    }
    const share = Math.floor(contextWindow * HANDOFF_WINDOW_SHARE * BYTES_PER_TOKEN);
    return Math.min(HANDOFF_CEILING_BYTES, Math.max(HANDOFF_FLOOR_BYTES, share));
}

const encoder = new TextEncoder();

export interface HandoffMeta {
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
    /* Set when the conversation ran on another machine, which names it: that machine cannot be read from here, so no line says how to. */
    remote?: { machine: string };
}

/* A moment as every machine writes it, so the text does not depend on the daemon's locale. */
function moment(at: number): string {
    return `${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/* The copied items per turn, oldest first; what belongs to no turn is left out, since the daemon wrote it. */
function turnsOf(items: readonly ChatItem[]): ChatItem[][] {
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
}

/*
 * What a CLI that takes over a conversation hears first: where it came from, how to read all of it,
 * and its last whole turns as text, added from the newest back until the budget is spent. The last
 * turn always goes along, however long it is, since a handoff without it has nothing to go on from.
 */
export function handoffText(items: readonly ChatItem[], meta: HandoffMeta, budget = HANDOFF_FLOOR_BYTES): { text: string; turns: number; all: boolean } {
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
    const lines = meta.remote
        ? [
              `Ruimte: you take over a conversation that ran with ${meta.fromName} on another machine (${meta.remote.machine}), in ${where} "${meta.originalTitle}", forked after its turn ${meta.turnNumber} of ${meta.totalTurns} on ${moment(meta.at)}.`,
              `Folder: ${meta.cwd}, a checkout of the same project on this machine. Its files may differ from the ones the original worked on.`,
              `The original cannot be read from this machine; only its turns up to turn ${meta.turnNumber} happened. What follows is ${part}, as text. The tool lines are what ${meta.fromName} ran, not you, so check the files before you assume.`
          ]
        : [
              `Ruimte: you take over a conversation that ran with ${meta.fromName} in ${where} ${meta.originalId} ("${meta.originalTitle}") on this machine, forked after its turn ${meta.turnNumber} of ${meta.totalTurns} on ${moment(meta.at)}.`,
              `Folder: ${folder}`,
              `The original is readable with: ruimte-context read ${meta.originalId} (add --tail 200 for the last part); only its turns up to turn ${meta.turnNumber} happened here. What follows is ${part}, as text. The tool lines are what ${meta.fromName} ran, not you, so check the files before you assume.`
          ];
    const text = [...lines, '---', kept.join('\n\n'), '---', "Continue from here. The person's next message follows."].join('\n');
    return { text, turns: kept.length, all: kept.length === rendered.length };
}
