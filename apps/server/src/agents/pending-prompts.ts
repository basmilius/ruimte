import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { isNotFound, writeAtomic } from '../fs.ts';

/*
 * The longest first prompt a verb takes. A terminal agent is started by a line the daemon types
 * into a shell that has not read a byte yet, so that line waits in the tty's canonical buffer
 * (four kilobytes on Linux, eight on macOS) until the shell gets to it, and a line past that is
 * silently cut off. A kickoff prompt of a page fits well under it; anything longer belongs in a
 * file the agent is told to read.
 */
export const MAX_PROMPT_LENGTH = 2000;

const PendingPromptSchema = z.object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
    prompt: z.string().min(1),
    createdAt: z.number()
});

type PendingPrompt = z.infer<typeof PendingPromptSchema>;

// The id is a node id the client chose, so it is encoded before it becomes a file name.
const fileName = (nodeId: string): string => `${encodeURIComponent(nodeId)}.json`;

/*
 * The first prompt of an agent node, held against the node id until the session or the chat for it
 * comes into being. It does not belong in `project.json`: the prompt is not part of the canvas two
 * people share, and a project open in two windows would deliver it twice. On disk, because the node
 * may well be made on a daemon that is restarted before the node is started.
 */
export class PendingPromptStore {
    readonly dir: string;
    private readonly pending = new Map<string, PendingPrompt>();

    constructor(home: string) {
        this.dir = join(home, 'prompts');
    }

    /* Reads what an earlier run of the daemon was still holding. Call before anything can take one. */
    async load(): Promise<void> {
        let names: string[];
        try {
            names = await readdir(this.dir);
        } catch (e) {
            if (isNotFound(e)) {
                return;
            }
            throw e;
        }
        for (const name of names) {
            if (!name.endsWith('.json')) {
                continue;
            }
            const raw = await readFile(join(this.dir, name), 'utf8').catch(() => null);
            if (raw === null) {
                continue;
            }
            let parsed: ReturnType<typeof PendingPromptSchema.safeParse>;
            try {
                parsed = PendingPromptSchema.safeParse(JSON.parse(raw));
            } catch {
                continue;
            }
            if (parsed.success) {
                this.pending.set(parsed.data.nodeId, parsed.data);
            }
        }
    }

    async put(projectId: string, nodeId: string, prompt: string): Promise<void> {
        const entry: PendingPrompt = { projectId, nodeId, prompt, createdAt: Date.now() };
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        await writeAtomic(join(this.dir, fileName(nodeId)), JSON.stringify(entry));
        this.pending.set(nodeId, entry);
    }

    /*
     * The prompt held for a node, gone the moment it is asked for. The map is emptied before the
     * first await, so two clients mounting the same node cannot both get it, and the file is gone
     * before the caller is answered, so a restart in between does not hand it out a second time.
     */
    async take(nodeId: string): Promise<string | null> {
        const entry = this.pending.get(nodeId);
        if (!entry) {
            return null;
        }
        this.pending.delete(nodeId);
        await rm(join(this.dir, fileName(nodeId)), { force: true });
        return entry.prompt;
    }

    has(nodeId: string): boolean {
        return this.pending.has(nodeId);
    }

    /* Drops what this project was holding for ids it no longer has: the node was deleted before anyone ran it. */
    async prune(projectId: string, ids: ReadonlySet<string>): Promise<void> {
        for (const entry of [...this.pending.values()]) {
            if (entry.projectId === projectId && !ids.has(entry.nodeId)) {
                this.pending.delete(entry.nodeId);
                await rm(join(this.dir, fileName(entry.nodeId)), { force: true });
            }
        }
    }
}
