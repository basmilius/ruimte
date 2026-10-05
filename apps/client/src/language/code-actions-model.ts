import { applyTextEdits, type CodeAction, type Command, type Diagnostic, type Range, type WorkspaceEdit } from '@ruimte/smart-editor-lsp';
import { comparePositions } from './diagnostics-model';
import { entriesOf, renamesOf } from './workspace-edit';

export type ActionGroup = 'quickfix' | 'rewrite' | 'extract' | 'inline' | 'move' | 'refactor' | 'source' | 'other';

/* The order of the list under the caret: the fixes and the rewrites that are one keystroke away first, the refactorings after them. */
export const ACTION_GROUPS: readonly ActionGroup[] = ['quickfix', 'rewrite', 'extract', 'inline', 'move', 'refactor', 'source', 'other'];

/* The order of Refactor This: what changes the structure of the code first, the rewrites after it. */
export const REFACTOR_GROUPS: readonly ActionGroup[] = ['extract', 'inline', 'move', 'rewrite', 'refactor'];

/* An action of a server with the id its row has in the list. */
export interface ActionEntry {
    readonly id: string;
    readonly action: CodeAction;
    readonly group: ActionGroup;
}

/* The kinds nest by dots: `refactor.extract.function` is an extraction and `source.organizeImports` a source action. */
export function groupOf(kind: string | undefined): ActionGroup {
    if (kind === 'quickfix' || kind?.startsWith('quickfix.')) {
        return 'quickfix';
    }
    for (const group of ['extract', 'inline', 'move', 'rewrite'] as const) {
        if (kind === `refactor.${group}` || kind?.startsWith(`refactor.${group}.`)) {
            return group;
        }
    }
    if (kind === 'refactor' || kind?.startsWith('refactor.')) {
        return 'refactor';
    }
    if (kind === 'source' || kind?.startsWith('source.')) {
        return 'source';
    }
    return 'other';
}

/*
 * What a server answered, as the rows of a list. A bare command becomes an action of its own, one a server
 * marked disabled is left out, and each group lists the preferred actions first, in the order the server gave.
 */
export function actionsOf(result: readonly (CodeAction | Command)[] | null, order: readonly ActionGroup[] = ACTION_GROUPS): ActionEntry[] {
    const entries = (result ?? [])
        .map((item) => (typeof item.command === 'string' ? ({ title: item.title, command: item as Command } satisfies CodeAction) : (item as CodeAction)))
        .filter((action) => action.disabled === undefined)
        .map((action, index) => ({ id: String(index), action, group: groupOf(action.kind) }));
    return order.flatMap((group) => {
        const own = entries.filter((entry) => entry.group === group);
        return [...own.filter((entry) => entry.action.isPreferred === true), ...own.filter((entry) => entry.action.isPreferred !== true)];
    });
}

/* Entries from several requests as one list: the same order as a single answer, and an id of its own for each row. Two actions with a title and kind alike are one. */
export function mergeEntries(lists: readonly (readonly ActionEntry[])[]): ActionEntry[] {
    const seen = new Set<string>();
    const unique = lists.flat().filter((entry) => {
        const key = `${entry.action.kind ?? ''}\0${entry.action.title}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
    return ACTION_GROUPS.flatMap((group) => {
        const own = unique.filter((entry) => entry.group === group);
        return [...own.filter((entry) => entry.action.isPreferred === true), ...own.filter((entry) => entry.action.isPreferred !== true)];
    }).map((entry, index) => ({ ...entry, id: String(index) }));
}

/* Whether the lightbulb offers it: a source action such as organizing imports is a command of its own and never a hint. */
export function isHint(entry: ActionEntry): boolean {
    return entry.group !== 'source';
}

/* The problems of a line that are worth a fix: errors and warnings, errors first, in the order of the line. */
export function fixableOnLine(diagnostics: readonly Diagnostic[], line: number): Diagnostic[] {
    return diagnostics
        .filter((diagnostic) => (diagnostic.severity ?? 1) <= 2 && diagnostic.range.start.line <= line && diagnostic.range.end.line >= line)
        .sort((left, right) => (left.severity ?? 1) - (right.severity ?? 1) || comparePositions(left.range.start, right.range.start));
}

function touches(range: Range, target: Range): boolean {
    return comparePositions(range.start, target.end) <= 0 && comparePositions(target.start, range.end) <= 0;
}

/* The problems an action may be about: the ones that overlap or touch the range it was asked for. */
export function diagnosticsAt(diagnostics: readonly Diagnostic[], range: Range): Diagnostic[] {
    return diagnostics.filter((diagnostic) => touches(diagnostic.range, range));
}

/* What an edit would change in the open file, as the lines it takes away and the lines that stand in their place. */
export interface EditPreview {
    readonly removed: readonly string[];
    readonly added: readonly string[];
    /* Lines left out of `removed` and `added` to keep the preview short. */
    readonly hiddenLines: number;
    /* The other files the edit reaches. */
    readonly otherFiles: number;
    /* The files it moves. */
    readonly moves: number;
}

const PREVIEW_LINES = 3;

function linesOf(text: string): string[] {
    return text.split(/\r\n|\r|\n/);
}

/* Null when the edit changes nothing, or creates or deletes a file, which a preview of lines cannot show. */
export function previewOf(text: string, edit: WorkspaceEdit, uri: string): EditPreview | null {
    const entries = entriesOf(edit);
    if (entries === null) {
        return null;
    }
    const own = entries.get(uri);
    const moves = renamesOf(edit).length;
    const otherFiles = [...entries.keys()].filter((key) => key !== uri).length;
    let removed: string[] = [];
    let added: string[] = [];
    if (own !== undefined) {
        let after: string;
        try {
            after = applyTextEdits(text, own.flat());
        } catch {
            return null;
        }
        const before = linesOf(text);
        const next = linesOf(after);
        let head = 0;
        while (head < before.length && head < next.length && before[head] === next[head]) {
            head++;
        }
        let tail = 0;
        while (tail < before.length - head && tail < next.length - head && before[before.length - 1 - tail] === next[next.length - 1 - tail]) {
            tail++;
        }
        removed = before.slice(head, before.length - tail);
        added = next.slice(head, next.length - tail);
    }
    if (removed.length === 0 && added.length === 0 && otherFiles === 0 && moves === 0) {
        return null;
    }
    const hiddenLines = Math.max(0, removed.length - PREVIEW_LINES) + Math.max(0, added.length - PREVIEW_LINES);
    return { removed: removed.slice(0, PREVIEW_LINES), added: added.slice(0, PREVIEW_LINES), hiddenLines, otherFiles, moves };
}
