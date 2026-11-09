import type { EditorRange } from '@adecore/editor';
import type { AgentKind } from '@ruimte/contracts';
import { z } from 'zod';
import { storedJson, type KeyValueStorage, type StoredValue } from '@/state/stored-json';

/* How long an inline edit that nobody opened as a chat stays findable, and then its hidden chat goes with its record. */
const INLINE_EDIT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

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

const PositionSchema = z.object({ line: z.int(), character: z.int() });

const RecordSchema = z.object({
    chatId: z.string(),
    viewId: z.string(),
    projectId: z.string(),
    path: z.string(),
    range: z.object({ start: PositionSchema, end: PositionSchema }),
    selectedText: z.string(),
    instruction: z.string(),
    provider: z.string(),
    createdAt: z.number()
});

/* What does not read as a record is left out rather than trusted; one that does is kept as it was stored. */
const InlineEditsSchema = z
    .record(z.string(), z.unknown())
    .transform((stored) =>
        Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, InlineEditRecord] => RecordSchema.safeParse(entry[1]).success))
    );

function inlineEdits(endpointId: string): StoredValue<Record<string, InlineEditRecord>> {
    return storedJson(`ruimte.inlineEdits.${endpointId}`, InlineEditsSchema);
}

export function readInlineEdits(endpointId: string, storage?: KeyValueStorage | null): Record<string, InlineEditRecord> {
    return inlineEdits(endpointId).read(storage) ?? {};
}

const listeners = new Set<() => void>();

/* Whoever draws a mark for a saved edit hears when one is kept or forgotten, since that happens while no editor looks. */
export function onInlineEditsChange(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function writeInlineEdits(endpointId: string, records: Record<string, InlineEditRecord>, storage: KeyValueStorage | null | undefined): void {
    if (Object.keys(records).length === 0) {
        inlineEdits(endpointId).remove(storage);
    } else {
        inlineEdits(endpointId).write(records, storage);
    }
    for (const listener of [...listeners]) {
        listener();
    }
}

export function inlineEditFor(endpointId: string, path: string, storage?: KeyValueStorage | null): InlineEditRecord | null {
    return readInlineEdits(endpointId, storage)[path] ?? null;
}

/* Keeps this record for its file, and returns the one it replaced so the chat behind it can be removed. */
export function saveInlineEdit(endpointId: string, record: InlineEditRecord, storage?: KeyValueStorage | null): InlineEditRecord | null {
    const records = readInlineEdits(endpointId, storage);
    const previous = records[record.path] ?? null;
    writeInlineEdits(endpointId, { ...records, [record.path]: record }, storage);
    return previous !== null && previous.chatId !== record.chatId ? previous : null;
}

export function forgetInlineEdit(endpointId: string, path: string, chatId: string, storage?: KeyValueStorage | null): void {
    const { [path]: record, ...rest } = readInlineEdits(endpointId, storage);
    // A record that has been replaced since belongs to a chat this call knows nothing about.
    writeInlineEdits(endpointId, record !== undefined && record.chatId !== chatId ? { ...rest, [path]: record } : rest, storage);
}

/* The records that outlived `INLINE_EDIT_KEEP_MS`, oldest first. */
export function expiredInlineEdits(endpointId: string, now: number, storage?: KeyValueStorage | null): InlineEditRecord[] {
    return Object.values(readInlineEdits(endpointId, storage))
        .filter((record) => now - record.createdAt >= INLINE_EDIT_KEEP_MS)
        .sort((left, right) => left.createdAt - right.createdAt);
}
