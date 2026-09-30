import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { isNotFound, writeAtomic } from '@ruimte/agents/fs';
import { privateDirOf, privatePathOf, viewFilePathOf } from './project-files.ts';

const MoveSchema = z.object({ kind: z.enum(['drawing', 'diagram']), viewId: z.string(), shared: z.boolean(), bytes: z.string() });
const WriteSchema = z.object({
    version: z.literal(1),
    before: z.object({ text: z.string().nullable(), private: z.string().nullable() }),
    after: z.object({ text: z.string(), private: z.string() }),
    moves: z.array(MoveSchema)
});
type PendingWrite = z.infer<typeof WriteSchema>;

export interface ProjectWriteIO {
    write: typeof writeAtomic;
    remove(path: string): Promise<void>;
}

const removeDurable = async (path: string): Promise<void> => {
    await rm(path, { force: true });
    if (process.platform !== 'win32') {
        const directory = await open(dirname(path), 'r');
        try {
            await directory.sync();
        } finally {
            await directory.close();
        }
    }
};

export const PROJECT_WRITE_IO: ProjectWriteIO = { write: writeAtomic, remove: removeDurable };
export const pendingWritePathOf = (path: string): string => join(privateDirOf(path), 'pending-save.json');

const bytesAt = async (path: string): Promise<Buffer | null> => {
    try {
        return await readFile(path);
    } catch (error) {
        if (isNotFound(error)) {
            return null;
        }
        throw error;
    }
};

const textAt = async (path: string): Promise<string | null> => (await bytesAt(path))?.toString('utf8') ?? null;

const movePaths = (path: string, move: PendingWrite['moves'][number]) => ({
    from: viewFilePathOf(path, move.kind, move.viewId, move.shared ? [] : [move.viewId]),
    to: viewFilePathOf(path, move.kind, move.viewId, move.shared ? [move.viewId] : [])
});

const checkMove = async (path: string, move: PendingWrite['moves'][number]) => {
    const { from, to } = movePaths(path, move);
    const source = await bytesAt(from);
    const target = await bytesAt(to);
    const expected = Buffer.from(move.bytes, 'base64');
    if ((source && !source.equals(expected)) || (target && !target.equals(expected)) || (!source && !target)) {
        throw new Error(`The interrupted project save needs recovery: the file of ${move.viewId} changed since it started`);
    }
    return { from, to, source, target, expected };
};

const complete = async (path: string, pending: PendingWrite, io: ProjectWriteIO): Promise<void> => {
    const files = [
        { path, before: pending.before.text, after: pending.after.text },
        { path: privatePathOf(path), before: pending.before.private, after: pending.after.private }
    ];
    // Recovery never overwrites an edit made after the interrupted save.
    for (const file of files) {
        const current = await textAt(file.path);
        if (current !== file.before && current !== file.after) {
            throw new Error(`The interrupted project save needs recovery: ${file.path} changed since it started`);
        }
    }
    for (const move of pending.moves) {
        await checkMove(path, move);
    }
    for (const file of files) {
        if ((await textAt(file.path)) !== file.after) {
            await mkdir(dirname(file.path), { recursive: true });
            await io.write(file.path, file.after, 0o644, { durable: true });
        }
    }
    for (const move of pending.moves) {
        const { from, to, target, expected } = await checkMove(path, move);
        if (!target) {
            await mkdir(dirname(to), { recursive: true });
            await io.write(to, expected, 0o644, { durable: true });
        }
        const { source } = await checkMove(path, move);
        if (source) {
            await io.remove(from);
        }
    }
    await io.remove(pendingWritePathOf(path));
};

export const recoverProjectWrite = async (path: string, io: ProjectWriteIO = PROJECT_WRITE_IO): Promise<PendingWrite['after'] | null> => {
    const text = await textAt(pendingWritePathOf(path));
    if (text === null) {
        return null;
    }
    const pending = WriteSchema.parse(JSON.parse(text));
    await complete(path, pending, io);
    return pending.after;
};

export const writeProjectFiles = async (
    path: string,
    after: PendingWrite['after'],
    moved: readonly string[] = [],
    shared: readonly string[] = [],
    io: ProjectWriteIO = PROJECT_WRITE_IO
): Promise<void> => {
    await recoverProjectWrite(path, io);
    const before = { text: await textAt(path), private: await textAt(privatePathOf(path)) };
    const moves: PendingWrite['moves'] = [];
    for (const viewId of moved) {
        for (const kind of ['drawing', 'diagram'] as const) {
            const move = { kind, viewId, shared: shared.includes(viewId), bytes: '' };
            const { from, to } = movePaths(path, move);
            const source = await bytesAt(from);
            if (source === null) {
                continue;
            }
            if (await bytesAt(to)) {
                throw new Error(`The file of ${viewId} already exists on both sides of the project; keep both files and resolve them before sharing`);
            }
            moves.push({ ...move, bytes: source.toString('base64') });
        }
    }
    if (before.text === after.text && before.private === after.private && moves.length === 0) {
        return;
    }
    await mkdir(privateDirOf(path), { recursive: true });
    // The intent is durable before the first project file changes, including every view file's bytes.
    await io.write(pendingWritePathOf(path), JSON.stringify({ version: 1, before, after, moves } satisfies PendingWrite), 0o600, { durable: true });
    await complete(path, { version: 1, before, after, moves }, io);
};
