import type { StateResult } from './helper-protocol.ts';

/* The last whole tree one agent got for one app, which the next state after an action is told against. */
export interface RememberedTree {
    instance: string | null;
    pid: number;
    /* The handle of the window the tree starts at. */
    root: number | null;
    sheet: string | null;
    lines: ReadonlyMap<number, string>;
    order: readonly number[];
}

export interface TreeChanges {
    added: number;
    gone: number;
    changed: number;
    /* `- ` before a line that went, `~ ` before the new form of one that changed, `+ ` before a new one. */
    lines: string[];
}

export type TreeView = { kind: 'full'; reason: string | null } | ({ kind: 'diff' } & TreeChanges);

const HANDLE = /^\s*\[(\d+)\]/;

export const handleOf = (line: string): number | null => {
    const match = HANDLE.exec(line);
    return match === null ? null : Number(match[1]);
};

export const rememberTree = (state: StateResult): RememberedTree => {
    const lines = new Map<number, string>();
    const order: number[] = [];
    for (const line of state.tree) {
        const handle = handleOf(line);
        if (handle !== null && !lines.has(handle)) {
            lines.set(handle, line);
            order.push(handle);
        }
    }
    return {
        instance: state.instance ?? null,
        pid: state.app.pid,
        root: state.tree.length === 0 ? null : handleOf(state.tree[0]!),
        sheet: state.window.sheet ?? null,
        lines,
        order
    };
};

/* Why a tree cannot be told as a change against the one before, or null when it can. */
const wholeBecause = (before: RememberedTree | undefined, after: RememberedTree): string | null => {
    if (before === undefined) {
        return 'the first state of this app you got';
    }
    if (before.instance !== after.instance || before.pid !== after.pid) {
        return 'the app or Ruimte Computer Use started again, so the numbers start over';
    }
    if (before.root !== after.root) {
        return 'a new window';
    }
    if (after.sheet !== null && before.sheet !== after.sheet) {
        return 'a new sheet';
    }
    return null;
};

/*
 * A tree told against the last one the agent got. Handles keep their element for as long as the helper
 * runs, so a line is the same element by its handle, and anything else about it is what changed.
 */
export const diffTree = (before: RememberedTree | undefined, after: RememberedTree): TreeView => {
    const reason = wholeBecause(before, after);
    if (before === undefined || reason !== null) {
        return { kind: 'full', reason };
    }
    const lines = before.order.filter((handle) => !after.lines.has(handle)).map((handle) => `- ${before.lines.get(handle)!}`);
    const gone = lines.length;
    let added = 0;
    let changed = 0;
    for (const handle of after.order) {
        const line = after.lines.get(handle)!;
        const previous = before.lines.get(handle);
        if (previous === undefined) {
            added += 1;
            lines.push(`+ ${line}`);
        } else if (previous !== line) {
            changed += 1;
            lines.push(`~ ${line}`);
        }
    }
    return { kind: 'diff', added, gone, changed, lines };
};
