import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentInfoSchema, ProviderAccountIdSchema, type AgentInfo } from '@ruimte/contracts';
import { isNotFound, writeAtomic } from '../fs.ts';

// Sits next to the screen snapshot of the same session, so both come back (or go) together.
const fileName = (sessionId: string): string => `${encodeURIComponent(sessionId)}.agent.json`;

export interface AgentRecord {
    agent: AgentInfo;
    // The account the node launched this CLI under, so a resume after a restart finds its transcript.
    account?: string;
}

/* The agent last seen in a session, kept on disk so a daemon restart can offer to resume it. */
export class AgentStore {
    readonly dir: string;

    constructor(home: string) {
        this.dir = join(home, 'sessions');
    }

    async write(sessionId: string, info: AgentInfo, account?: string): Promise<void> {
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        await writeAtomic(join(this.dir, fileName(sessionId)), JSON.stringify(account === undefined ? info : { ...info, account }));
    }

    async read(sessionId: string): Promise<AgentInfo | null> {
        return (await this.readRecord(sessionId))?.agent ?? null;
    }

    async readRecord(sessionId: string): Promise<AgentRecord | null> {
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
            const json: unknown = JSON.parse(raw);
            const parsed = AgentInfoSchema.safeParse(json);
            if (!parsed.success) {
                return null;
            }
            const account = ProviderAccountIdSchema.safeParse((json as { account?: unknown }).account);
            return account.success ? { agent: parsed.data, account: account.data } : { agent: parsed.data };
        } catch {
            return null;
        }
    }

    async delete(sessionId: string): Promise<void> {
        await rm(join(this.dir, fileName(sessionId)), { force: true });
    }
}
