import type { AgentKind } from '@ruimte/contracts';
import type { EditorRange } from '@adecore/editor';
import { browserStorage, type LastProjectStorage } from '@/project/last-project';

/* How long an inline edit that nobody opened as a chat stays findable, and then its hidden chat goes with its record. */
export const INLINE_EDIT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/*
 * What this client keeps of an inline edit so the card can be shown again after a reload: the chat,
 * the lines the edit was about and the text that stood there. One per file, since a new edit in a file
 * takes the place of the one before it.
 */
export interface InlineEditRecord {
    readonly chatId: string;
    readonly viewId: string;
    readonly projectId: string;
    /* The absolute path on the machine, which is what an open editor knows its file by. */
    readonly path: string;
    readonly range: EditorRange;
    readonly selectedText: string;
    readonly instruction: string;
    readonly provider: AgentKind;
    readonly model: string | null;
    readonly createdAt: number;
}

function keyOf(endpointId: string): string {
    return `ruimte.inlineEdits.${endpointId}`;
}

function isPosition(value: unknown): boolean {
    return (
        typeof value === 'object' &&
        value !== null &&
        Number.isInteger((value as { line?: unknown }).line) &&
        Number.isInteger((value as { character?: unknown }).character)
    );
}

function isRecord(value: unknown): value is InlineEditRecord {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const record = value as Record<string, unknown>;
    const range = record.range as { start?: unknown; end?: unknown } | undefined;
    return (
        typeof record.chatId === 'string' &&
        typeof record.viewId === 'string' &&
        typeof record.projectId === 'string' &&
        typeof record.path === 'string' &&
        typeof record.selectedText === 'string' &&
        typeof record.instruction === 'string' &&
        typeof record.provider === 'string' &&
        typeof record.createdAt === 'number' &&
        range !== undefined &&
        isPosition(range.start) &&
        isPosition(range.end)
    );
}

/* The records of one machine by path; what does not read as a record is left out rather than trusted. */
export function readInlineEdits(endpointId: string, storage: LastProjectStorage | null = browserStorage()): Record<string, InlineEditRecord> {
    const raw = storage?.getItem(keyOf(endpointId)) ?? null;
    if (raw === null) {
        return {};
    }
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return {};
        }
        return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, InlineEditRecord] => isRecord(entry[1])));
    } catch {
        return {};
    }
}

const listeners = new Set<() => void>();

/* Whoever draws a mark for a saved edit hears when one is kept or forgotten, since that happens while no editor looks. */
export function onInlineEditsChange(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function writeInlineEdits(endpointId: string, records: Record<string, InlineEditRecord>, storage: LastProjectStorage | null): void {
    if (Object.keys(records).length === 0) {
        storage?.removeItem(keyOf(endpointId));
    } else {
        storage?.setItem(keyOf(endpointId), JSON.stringify(records));
    }
    for (const listener of [...listeners]) {
        listener();
    }
}

export function inlineEditFor(endpointId: string, path: string, storage: LastProjectStorage | null = browserStorage()): InlineEditRecord | null {
    return readInlineEdits(endpointId, storage)[path] ?? null;
}

/* Keeps this record for its file, and returns the one it replaced so the chat behind it can be removed. */
export function saveInlineEdit(endpointId: string, record: InlineEditRecord, storage: LastProjectStorage | null = browserStorage()): InlineEditRecord | null {
    const records = readInlineEdits(endpointId, storage);
    const previous = records[record.path] ?? null;
    writeInlineEdits(endpointId, { ...records, [record.path]: record }, storage);
    return previous !== null && previous.chatId !== record.chatId ? previous : null;
}

export function forgetInlineEdit(endpointId: string, path: string, chatId: string, storage: LastProjectStorage | null = browserStorage()): void {
    const { [path]: record, ...rest } = readInlineEdits(endpointId, storage);
    // A record that has been replaced since belongs to a chat this call knows nothing about.
    writeInlineEdits(endpointId, record !== undefined && record.chatId !== chatId ? { ...rest, [path]: record } : rest, storage);
}

/* The records that outlived `INLINE_EDIT_KEEP_MS`, oldest first. */
export function expiredInlineEdits(endpointId: string, now: number, storage: LastProjectStorage | null = browserStorage()): InlineEditRecord[] {
    return Object.values(readInlineEdits(endpointId, storage))
        .filter((record) => now - record.createdAt >= INLINE_EDIT_KEEP_MS)
        .sort((left, right) => left.createdAt - right.createdAt);
}
