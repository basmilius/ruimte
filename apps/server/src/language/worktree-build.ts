import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isNotFound } from '@adecore/utils/errors';
import { writeAtomic } from '@adecore/utils/fs';

/* What a language server says about a kind it keeps from building code in a worktree, which an agent reads as the `message` of that server. */
export const BUILD_HELD_MESSAGE = 'Build scripts and macros are off in this worktree';

/*
 * The repositories, by main checkout, whose servers may build code in the worktrees of agents. It is the
 * machine's and never a project's: a project file is one an agent with a shell can rewrite, and the point
 * is that a person allows what such an agent just wrote.
 */
export class WorktreeBuildChoices {
    private readonly path: string;
    private repositories = new Set<string>();

    constructor(options: { path: string }) {
        this.path = options.path;
    }

    async load(): Promise<void> {
        try {
            const parsed = JSON.parse(await readFile(this.path, 'utf8')) as { on?: unknown };

            if (Array.isArray(parsed.on)) {
                this.repositories = new Set(parsed.on.filter((main): main is string => typeof main === 'string'));
            }
        } catch (error) {
            if (!isNotFound(error)) {
                console.error(`${this.path} could not be read, so build code stays off in the worktrees of agents:`, error);
            }
        }
    }

    isOn(main: string): boolean {
        return this.repositories.has(main);
    }

    async set(main: string, on: boolean): Promise<void> {
        const next = new Set(this.repositories);

        if (on) {
            next.add(main);
        } else {
            next.delete(main);
        }

        this.repositories = next;
        await mkdir(dirname(this.path), { recursive: true });
        await writeAtomic(this.path, `${JSON.stringify({ on: [...next].sort() }, null, 2)}\n`);
    }
}
