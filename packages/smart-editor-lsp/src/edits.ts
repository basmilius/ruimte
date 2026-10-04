import { ErrorCodes, LspError } from './connection.ts';
import type { ContentChange, Position, TextEdit, WorkspaceEdit } from './protocol.ts';

export interface DocumentSnapshot {
    text: string;
    version: number | null;
}

export interface PlannedDocumentEdit {
    uri: string;
    version: number | null;
    before: string;
    text: string;
}

/* A line ends at `\n`, `\r\n` or a lone `\r`, which is how the protocol counts lines. */
export function offsetAt(text: string, position: Position): number {
    if (!Number.isInteger(position.line) || !Number.isInteger(position.character) || position.line < 0 || position.character < 0) {
        throw new LspError('Invalid edit position');
    }
    let line = 0;
    let offset = 0;
    while (line < position.line && offset < text.length) {
        const char = text.charCodeAt(offset++);
        if (char === 13) {
            if (text.charCodeAt(offset) === 10) {
                offset++;
            }
            line++;
        } else if (char === 10) {
            line++;
        }
    }
    if (line !== position.line) {
        throw new LspError('Edit line is outside the document');
    }
    let end = offset;
    while (end < text.length && text[end] !== '\r' && text[end] !== '\n') {
        end++;
    }
    if (offset + position.character > end) {
        throw new LspError('Edit character is outside the line');
    }
    return offset + position.character;
}

export function positionAt(text: string, offset: number): Position {
    if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
        throw new LspError('Offset is outside the document');
    }
    let line = 0;
    let lineStart = 0;
    let i = 0;
    while (i < offset) {
        const code = text.charCodeAt(i);
        if (code === 13 && text.charCodeAt(i + 1) === 10) {
            if (i + 2 > offset) {
                break;
            }
            i += 2;
            line++;
            lineStart = i;
        } else if (code === 13 || code === 10) {
            i++;
            line++;
            lineStart = i;
        } else {
            i++;
        }
    }
    return { line, character: offset - lineStart };
}

/* The position after the last character. */
export function endPosition(text: string): Position {
    return positionAt(text, text.length);
}

/* Edits are simultaneous and in the coordinates of `text`; two inserts at one place keep their order. */
export function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
    const spans = edits
        .map((edit, index) => ({
            start: offsetAt(text, edit.range.start),
            end: offsetAt(text, edit.range.end),
            text: edit.newText,
            index
        }))
        .sort((a, b) => a.start - b.start || a.index - b.index);
    let cursor = 0;
    const parts: string[] = [];
    for (const span of spans) {
        if (span.end < span.start) {
            throw new LspError('Edit range is reversed');
        }
        if (span.start < cursor) {
            throw new LspError('Workspace edits overlap');
        }
        parts.push(text.slice(cursor, span.start), span.text);
        cursor = span.end;
    }
    parts.push(text.slice(cursor));
    return parts.join('');
}

/* `didChange` entries apply one after the other, each in the coordinates the one before left. */
export function applyContentChanges(text: string, changes: readonly ContentChange[]): string {
    let result = text;
    for (const change of changes) {
        if (!change.range) {
            result = change.text;
            continue;
        }
        const start = offsetAt(result, change.range.start);
        const end = offsetAt(result, change.range.end);
        if (end < start) {
            throw new LspError('Change range is reversed');
        }
        result = result.slice(0, start) + change.text + result.slice(end);
    }
    return result;
}

function isHighSurrogate(code: number): boolean {
    return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
    return code >= 0xdc00 && code <= 0xdfff;
}

/*
 * The one change that turns `before` into `after`: what is left once the shared start and end are
 * taken off. A range never starts or ends inside a surrogate pair or a CRLF, which no position can
 * name.
 */
export function minimalChange(before: string, after: string): ContentChange {
    const shortest = Math.min(before.length, after.length);
    let start = 0;
    while (start < shortest && before.charCodeAt(start) === after.charCodeAt(start)) {
        start++;
    }
    if (start > 0 && (isHighSurrogate(before.charCodeAt(start - 1)) || (before[start - 1] === '\r' && before[start] === '\n'))) {
        start--;
    }
    let end = 0;
    while (end < shortest - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) {
        end++;
    }
    if (
        end > 0 &&
        (isLowSurrogate(before.charCodeAt(before.length - end)) || (before[before.length - end] === '\n' && before[before.length - end - 1] === '\r'))
    ) {
        end--;
    }
    return {
        range: { start: positionAt(before, start), end: positionAt(before, before.length - end) },
        text: after.slice(start, after.length - end)
    };
}

/* Plans text edits in memory. A create, rename or delete needs the host's own handling and is refused. */
export function planWorkspaceEdit(edit: WorkspaceEdit, snapshots: ReadonlyMap<string, DocumentSnapshot>): PlannedDocumentEdit[] {
    const planned = new Map<string, PlannedDocumentEdit>();
    const changes = edit.documentChanges ?? Object.entries(edit.changes ?? {}).map(([uri, edits]) => ({ textDocument: { uri, version: null }, edits }));
    for (const change of changes) {
        if ('kind' in change) {
            throw new LspError(`A host file-operation handler is required for ${change.kind}`);
        }
        const { uri, version } = change.textDocument;
        const snapshot = snapshots.get(uri);
        if (!snapshot) {
            throw new LspError(`Missing workspace snapshot: ${uri}`);
        }
        if (version !== null && snapshot.version !== version) {
            throw new LspError(`Workspace edit version mismatch: ${uri}`, ErrorCodes.ContentModified);
        }
        const before = planned.get(uri)?.text ?? snapshot.text;
        const text = applyTextEdits(before, change.edits);
        planned.set(uri, { uri, version: snapshot.version, before: snapshot.text, text });
    }
    return [...planned.values()];
}
