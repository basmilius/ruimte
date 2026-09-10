import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ChatCheckpointDiff, ChatCheckpointFile } from '@ruimte/contracts';
import { git } from './run.ts';

// Beyond these a diff stops being something a person reads, and the chat file stops being small.
const MAX_FILES = 100;
const MAX_FILE_LINES = 2000;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024;

export interface CheckpointService {
    take(cwd: string): Promise<string | null>;
    diff(cwd: string, tree: string): Promise<ChatCheckpointDiff | null>;
}

// One index per repository, and one turn at a time in it: two chats in the same folder would
// otherwise fight over the lock file git writes next to it.
const queues = new Map<string, Promise<unknown>>();

const serialize = <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const next = (queues.get(key) ?? Promise.resolve()).then(work, work);
    queues.set(
        key,
        next.catch(() => undefined)
    );
    return next;
};

const countedLines = (numstat: string): number => {
    const added = Number.parseInt(numstat, 10);
    return Number.isNaN(added) ? 0 : added;
};

/*
 * Git trees of a chat's folder, one per turn, so the changed-files card can show what the working
 * tree holds now against what it held when the turn started. The tree is written through an index
 * file of ours (`GIT_INDEX_FILE`), so the person's own index, their stashes and their commits are
 * never touched; `git add -A` against that index means ignored files stay ignored and untracked
 * ones count. A folder outside a repository, or a git that fails, answers null and the card falls
 * back to what the CLI itself reported.
 */
export class Checkpoints implements CheckpointService {
    readonly root: string;

    constructor(home: string) {
        this.root = join(home, 'checkpoints');
    }

    /* The tree of the working tree as it is now, or null when there is nothing to check point. */
    async take(cwd: string): Promise<string | null> {
        const top = await this.toplevel(cwd);
        if (top === null) {
            return null;
        }
        const index = await this.indexFile(top);
        if (index === null) {
            return null;
        }
        return await serialize(index, async () => {
            const env = { GIT_INDEX_FILE: index };
            if ((await git(['add', '-A'], top, env)) === null) {
                return null;
            }
            const tree = await git(['write-tree'], top, env);
            return tree === null ? null : tree.trim() || null;
        });
    }

    /* What changed since that tree: one unified diff per file, with the counts the card shows. */
    async diff(cwd: string, tree: string): Promise<ChatCheckpointDiff | null> {
        const top = await this.toplevel(cwd);
        if (top === null) {
            return null;
        }
        // The working tree as a tree of its own, so files the agent created are in the comparison
        // (`git diff <tree>` against the working tree only sees what git already tracks).
        const now = await this.take(cwd);
        if (now === null) {
            return null;
        }
        const numstat = await git(['diff', '--numstat', '-z', '--no-renames', tree, now], top);
        const status = await git(['diff', '--name-status', '-z', '--no-renames', tree, now], top);
        if (numstat === null || status === null) {
            return null;
        }
        const kinds = kindsByPath(status);
        const counts = parseNumstat(numstat);
        const files: ChatCheckpointFile[] = [];
        let budget = MAX_TOTAL_BYTES;
        for (const count of counts.slice(0, MAX_FILES)) {
            const file: ChatCheckpointFile = {
                path: count.path,
                kind: kinds.get(count.path) ?? 'update',
                added: count.added,
                deleted: count.deleted,
                diff: ''
            };
            if (count.binary) {
                file.omitted = 'binary';
            } else if (count.added + count.deleted > MAX_FILE_LINES) {
                file.omitted = 'too-large';
            } else {
                const body = await git(['diff', '--no-color', '--no-ext-diff', tree, now, '--', `:(literal)${count.path}`], top);
                if (body === null || body.length > MAX_FILE_BYTES || body.length > budget) {
                    file.omitted = 'too-large';
                } else {
                    file.diff = body;
                    budget -= body.length;
                }
            }
            files.push(file);
        }
        return { files, truncated: counts.length > files.length };
    }

    private async toplevel(cwd: string): Promise<string | null> {
        const top = await git(['rev-parse', '--show-toplevel'], cwd);
        return top === null ? null : top.trim() || null;
    }

    private async indexFile(top: string): Promise<string | null> {
        try {
            await mkdir(this.root, { recursive: true, mode: 0o700 });
        } catch {
            return null;
        }
        return join(this.root, `${basename(top)}-${createHash('sha1').update(top).digest('hex').slice(0, 8)}.index`);
    }
}

interface Numstat {
    path: string;
    added: number;
    deleted: number;
    binary: boolean;
}

// `--numstat -z` writes `<added>\t<deleted>\t<path>` per file, NUL terminated; a binary file counts `-`.
const parseNumstat = (output: string): Numstat[] => {
    const entries: Numstat[] = [];
    for (const record of output.split('\0')) {
        if (record === '') {
            continue;
        }
        const [added = '', deleted = '', ...rest] = record.split('\t');
        const path = rest.join('\t');
        if (path === '') {
            continue;
        }
        entries.push({ path, added: countedLines(added), deleted: countedLines(deleted), binary: added === '-' });
    }
    return entries;
};

// `--name-status -z` alternates a status letter and the path it belongs to.
const kindsByPath = (output: string): Map<string, ChatCheckpointFile['kind']> => {
    const kinds = new Map<string, ChatCheckpointFile['kind']>();
    const fields = output.split('\0').filter((field) => field !== '');
    for (let i = 0; i + 1 < fields.length; i += 2) {
        const letter = fields[i]![0];
        kinds.set(fields[i + 1]!, letter === 'A' ? 'add' : letter === 'D' ? 'delete' : 'update');
    }
    return kinds;
};
