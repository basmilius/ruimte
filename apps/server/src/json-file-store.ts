import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { writeAtomicSync } from '@adecore/utils/fs';
import type { z } from 'zod';
import { errorText } from './error-text.ts';

/*
 * One JSON file under `$RUIMTE_HOME` that a store reads once at its start and writes whole on every
 * change, atomically. Without a path it keeps nothing, which is how a test runs a store in memory.
 */
export class JsonFileStore<T> {
    private readonly path: string | undefined;
    private readonly schema: z.ZodType<T>;
    /* What the warning says happens when the file will not read, as in "snoozes start empty". */
    private readonly unreadable: string;

    constructor(path: string | undefined, schema: z.ZodType<T>, unreadable: string) {
        this.path = path;
        this.schema = schema;
        this.unreadable = unreadable;
    }

    /* Null without a path or a file, and for a file that will not read, which only warns. */
    read(): T | null {
        if (!this.path || !existsSync(this.path)) {
            return null;
        }
        try {
            return this.schema.parse(JSON.parse(readFileSync(this.path, 'utf8')));
        } catch (e) {
            console.warn(`${this.path} would not read; ${this.unreadable}:`, errorText(e));
            return null;
        }
    }

    write(value: T): void {
        if (!this.path) {
            return;
        }
        mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
        writeAtomicSync(this.path, JSON.stringify(value));
    }
}
