import { randomUUID } from 'node:crypto';
import { open, rename, rm, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/* Four times the largest piece of a `bytes.read`, so a page cannot hand the main process a whole file at once. */
export const SAVE_STREAM_PIECE_MAX = 1024 * 1024;

interface OpenSave {
    owner: number;
    target: string;
    partial: string;
    file: FileHandle;
    /* Every write, end and abort waits on the one before, so pieces land in the order they were sent. */
    tail: Promise<void>;
}

/*
 * Files a page writes piece by piece to a place a person picked. The bytes go to a hidden file beside
 * the target, which takes the target's name only at the end, so a save that breaks off never leaves a
 * half file under the name a person chose. An id answers only the owner (a window) that began it.
 */
export class SaveStreams {
    private readonly saves = new Map<string, OpenSave>();

    async begin(owner: number, target: string): Promise<string> {
        const id = randomUUID();
        const partial = join(dirname(target), `.${basename(target)}.${id}.part`);
        const file = await open(partial, 'wx');
        this.saves.set(id, { owner, target, partial, file, tail: Promise.resolve() });
        return id;
    }

    write(owner: number, id: string, bytes: Uint8Array): Promise<void> {
        const save = this.owned(owner, id);
        if (!(bytes instanceof Uint8Array) || bytes.length > SAVE_STREAM_PIECE_MAX) {
            return this.abort(owner, id).then(() => {
                throw new Error(`A piece holds at most ${SAVE_STREAM_PIECE_MAX} bytes`);
            });
        }
        return this.after(save, async () => {
            await save.file.write(bytes);
        });
    }

    async end(owner: number, id: string): Promise<string> {
        const save = this.owned(owner, id);
        this.saves.delete(id);
        try {
            await this.after(save, async () => {
                await save.file.close();
                await rename(save.partial, save.target);
            });
        } catch (error: unknown) {
            await rm(save.partial, { force: true });
            throw error;
        }
        return save.target;
    }

    async abort(owner: number, id: string): Promise<void> {
        const save = this.saves.get(id);
        if (save === undefined || save.owner !== owner) {
            return;
        }
        this.saves.delete(id);
        await this.discard(save);
    }

    /* Everything a window still had open, when it goes or loads another page. */
    async abortOwner(owner: number): Promise<void> {
        const saves = [...this.saves.entries()].filter(([, save]) => save.owner === owner);
        for (const [id] of saves) {
            this.saves.delete(id);
        }
        await Promise.all(saves.map(([, save]) => this.discard(save)));
    }

    private owned(owner: number, id: string): OpenSave {
        const save = this.saves.get(id);
        if (save === undefined || save.owner !== owner) {
            throw new Error('No such save');
        }
        return save;
    }

    private after(save: OpenSave, step: () => Promise<void>): Promise<void> {
        const next = save.tail.then(step);
        save.tail = next.catch(() => undefined);
        return next;
    }

    private async discard(save: OpenSave): Promise<void> {
        await save.tail;
        await save.file.close().catch(() => undefined);
        await rm(save.partial, { force: true });
    }
}
