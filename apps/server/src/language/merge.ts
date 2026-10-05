/*
 * Several servers can serve one document, such as the TypeScript server and ESLint. A feature that
 * adds up, such as suggestions or fixes, is asked of every server that offers it and the answers are
 * merged here; any other feature is the first server's that offers it.
 */

export const MERGED_METHODS: ReadonlySet<string> = new Set(['textDocument/completion', 'textDocument/codeAction', 'textDocument/hover']);

export interface ServerAnswer {
    server: string;
    result: unknown;
    /* When the answer is a list that already merges several processes: the one that made each item. */
    itemServers?: readonly string[];
}

export interface MergedAnswer {
    result: unknown;
    /* For a list that was merged: which process each item came from, so an item resolves against the process that made it. */
    itemServers?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* A completion answer is a list of items or a list with a flag that says it is incomplete. */
function completionPart(result: unknown): { items: unknown[]; isIncomplete: boolean } {
    if (Array.isArray(result)) {
        return { items: result, isIncomplete: false };
    }
    if (isRecord(result) && Array.isArray(result.items)) {
        return { items: result.items, isIncomplete: result.isIncomplete === true };
    }
    return { items: [], isIncomplete: false };
}

/* The parts of a hover as marked strings, which is the one shape that holds several. */
function hoverParts(contents: unknown): unknown[] {
    if (Array.isArray(contents)) {
        return contents;
    }
    if (isRecord(contents) && typeof contents.kind === 'string' && typeof contents.value === 'string') {
        return [contents.value];
    }
    return contents === undefined || contents === null ? [] : [contents];
}

function mergeHover(answers: readonly ServerAnswer[]): unknown {
    const hovers = answers.filter((answer): answer is ServerAnswer & { result: Record<string, unknown> } => isRecord(answer.result));
    if (hovers.length === 0) {
        return null;
    }
    const range = hovers.find((hover) => hover.result.range !== undefined)?.result.range;
    return { contents: hovers.flatMap((hover) => hoverParts(hover.result.contents)), ...(range === undefined ? {} : { range }) };
}

/* Answers to one request, in the order of the servers that gave them. `null` is no answer. */
export function mergeAnswers(method: string, answers: readonly ServerAnswer[]): MergedAnswer {
    if (method === 'textDocument/hover') {
        return { result: mergeHover(answers) };
    }
    const itemServers: string[] = [];
    const items: unknown[] = [];
    let isIncomplete = false;
    for (const answer of answers) {
        const part = completionPart(answer.result);
        isIncomplete ||= part.isIncomplete;
        part.items.forEach((item, index) => {
            items.push(item);
            itemServers.push(answer.itemServers?.[index] ?? answer.server);
        });
    }
    if (method === 'textDocument/completion') {
        return { result: { isIncomplete, items }, itemServers };
    }
    return { result: items.length === 0 && answers.every((answer) => answer.result === null) ? null : items, itemServers };
}

function actionKind(action: unknown): string | undefined {
    return isRecord(action) && typeof action.kind === 'string' ? action.kind : undefined;
}

function actionKey(action: unknown): string {
    return `${actionKind(action) ?? ''}\0${isRecord(action) && typeof action.title === 'string' ? action.title : ''}`;
}

/*
 * The code actions of the server of the language and of its sidecar as one list, the server's own first.
 * An action the sidecar offers under the same title and kind is the server's, and a `source.*` kind the
 * server offers at all is left to it (organize imports, remove unused imports and the like exist in both under other titles).
 */
export function mergeCodeActions(primary: ServerAnswer, extra: ServerAnswer): MergedAnswer {
    const own = completionPart(primary.result).items;
    const items = [...own];
    const itemServers = own.map(() => primary.server);
    const taken = new Set(own.map(actionKey));
    const ownKinds = new Set(own.map(actionKind));
    for (const action of completionPart(extra.result).items) {
        const kind = actionKind(action);
        if (taken.has(actionKey(action)) || (kind?.startsWith('source.') === true && ownKinds.has(kind))) {
            continue;
        }
        items.push(action);
        itemServers.push(extra.server);
    }
    return { result: items.length === 0 && primary.result === null && extra.result === null ? null : items, itemServers };
}

/* Options a union serves better than the first server's: what triggers a feature and which kinds of action it offers. */
function mergeOptions(method: string, left: unknown, right: unknown): unknown {
    if (!isRecord(left) || !isRecord(right)) {
        return left;
    }
    const merged: Record<string, unknown> = { ...right, ...left };
    const unionOf = (key: string): void => {
        const both = [...(Array.isArray(left[key]) ? left[key] : []), ...(Array.isArray(right[key]) ? right[key] : [])];
        if (both.length > 0) {
            merged[key] = [...new Set(both)];
        }
    };
    if (method === 'textDocument/completion') {
        unionOf('triggerCharacters');
        unionOf('allCommitCharacters');
    }
    if (method === 'textDocument/codeAction') {
        unionOf('codeActionKinds');
    }
    if (left.resolveProvider === true || right.resolveProvider === true) {
        merged.resolveProvider = true;
    }
    return merged;
}

/* What the document may ask, as the servers that serve it offered it: the first server's options, widened for the features that merge. */
export function mergeProviders(offers: readonly Record<string, unknown>[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const offer of offers) {
        for (const [method, options] of Object.entries(offer)) {
            result[method] = method in result && MERGED_METHODS.has(method) ? mergeOptions(method, result[method], options) : (result[method] ?? options);
        }
    }
    return result;
}
