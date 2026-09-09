import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentInfoSchema, type AgentInfo } from '@ruimte/contracts';
import { isNotFound, writeAtomic } from '../fs.ts';

// Sits next to the screen snapshot of the same session, so both come back (or go) together.
const fileName = (sessionId: string): string => `${encodeURIComponent(sessionId)}.agent.json`;

/* The agent last seen in a session, kept on disk so a daemon restart can offer to resume it. */
export class AgentStore {
    readonly dir: string;

    constructor(home: string) {
        this.dir = join(home, 'sessions');
    }

    async write(sessionId: string, info: AgentInfo): Promise<void> {
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        await writeAtomic(join(this.dir, fileName(sessionId)), JSON.stringify(info));
    }

    async read(sessionId: string): Promise<AgentInfo | null> {
        let raw: string;
        try {
            raw = await readFile(join(this.dir, fileName(sessionId)), 'utf8');
        } catch (e) {
            if (isNotFound(e)) {
                return null;
            }
            throw e;
        }
        try {
            const parsed = AgentInfoSchema.safeParse(JSON.parse(raw));
            return parsed.success ? parsed.data : null;
        } catch {
            return null;
        }
    }

    async delete(sessionId: string): Promise<void> {
        await rm(join(this.dir, fileName(sessionId)), { force: true });
    }
}
