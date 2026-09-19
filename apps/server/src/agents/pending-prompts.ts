import { join } from 'node:path';
import { RecordDirectory } from '../record-directory.ts';
import { z } from 'zod';

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

/*
 * The first prompt of an agent node, held against the node id until the session or the chat for it
 * comes into being. It does not belong in `project.json`: the prompt is not part of the canvas two
 * people share, and a project open in two windows would deliver it twice. On disk, because the node
 * may well be made on a daemon that is restarted before the node is started.
 */
export class PendingPromptStore {
    readonly dir: string;
    private readonly pending: RecordDirectory<PendingPrompt>;

    constructor(home: string) {
        this.dir = join(home, 'prompts');
        this.pending = new RecordDirectory({ dir: this.dir, schema: PendingPromptSchema, idOf: (entry) => entry.nodeId });
    }

    /* Reads what an earlier run of the daemon was still holding. Call before anything can take one. */
    load(): Promise<void> {
        return this.pending.load();
    }

    async put(projectId: string, nodeId: string, prompt: string): Promise<void> {
        await this.pending.write({ projectId, nodeId, prompt, createdAt: Date.now() });
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
        await this.pending.remove(nodeId);
        return entry.prompt;
    }

    has(nodeId: string): boolean {
        return this.pending.has(nodeId);
    }

    /* Drops what this project was holding for ids it no longer has: the node was deleted before anyone ran it. */
    prune(projectId: string, ids: ReadonlySet<string>): Promise<void> {
        return this.pending.prune((entry) => entry.projectId === projectId && !ids.has(entry.nodeId));
    }
}
