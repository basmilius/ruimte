import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Compiled } from './react-compiler-babel.ts';

/*
 * What the React Compiler made, one file per module under Vite's own cache folder, shared by `bun dev`,
 * `vite build` and the tests (and kept between CI runs by `ci.yml`). An entry holds only while the
 * module's text, the lockfile (the compiler and Babel) and the compiler's set-up are what it was made from.
 */

export const REACT_COMPILER_CACHE = fileURLToPath(new URL('./node_modules/.vite/react-compiler', import.meta.url));

const INPUTS = ['../../bun.lock', './react-compiler.ts', './react-compiler-babel.ts'].map((path) => new URL(path, import.meta.url));

interface Entry extends Compiled {
    key: string;
}

export class CompilerCache {
    private readonly version = hash(...INPUTS.map((file) => (existsSync(file) ? readFileSync(file, 'utf8') : '')));

    async read(id: string, code: string): Promise<Compiled | null> {
        try {
            const entry = JSON.parse(await readFile(this.file(id), 'utf8')) as Entry;
            return entry.key === hash(this.version, code) ? { code: entry.code, map: entry.map } : null;
        } catch {
            return null;
        }
    }

    // Written aside and moved in, so a process that stops halfway never leaves half a module for the next one.
    async write(id: string, code: string, compiled: Compiled): Promise<void> {
        const file = this.file(id);
        const aside = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
        try {
            await mkdir(REACT_COMPILER_CACHE, { recursive: true });
            await writeFile(aside, JSON.stringify({ key: hash(this.version, code), ...compiled } satisfies Entry));
            await rename(aside, file);
        } catch {
            // A module that is not kept is compiled again next time.
        }
    }

    private file(id: string): string {
        return join(REACT_COMPILER_CACHE, `${hash(id)}.json`);
    }
}

function hash(...parts: readonly string[]): string {
    const digest = createHash('sha256');
    for (const part of parts) {
        digest.update(part).update('\0');
    }
    return digest.digest('hex');
}
