import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatHistoryResult, ChatItem } from '@ruimte/contracts';
import { readLines } from '@ruimte/agents/title-file';
import { ClaudeProtocol } from '@ruimte/agents/chat/claude-protocol';
import { readingThread, settledReading } from '@ruimte/agents/chat/subagent-projection';
import type { ChatThread } from '@ruimte/agents/chat/thread';
import type { ThreadProjector } from '@ruimte/agents/chat/projector';

const CHUNK_BYTES = 4 * 1024 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/* The words of a user line that somebody said, or null for a line that carries tool results. */
const spokenText = (content: unknown): string | null => {
    if (typeof content === 'string') {
        return content;
    }
    if (!Array.isArray(content) || content.some((block) => isRecord(block) && block.type === 'tool_result')) {
        return null;
    }
    const texts = content.filter((block) => isRecord(block) && block.type === 'text').map((block) => String((block as { text?: unknown }).text ?? ''));
    return texts.length === 0 ? null : texts.join('\n');
};

/* What Claude Code writes beside a subagent's transcript. Pinned on 2.1.273, where only the agent's own id is always there. */
export interface SubagentMeta {
    agentId: string;
    toolUseId: string | null;
    // Set for an agent a subagent opened, which gets a file of its own in the same folder.
    parentAgentId: string | null;
    description: string | null;
    transcript: string;
}

/* The folder name Claude Code gives a working directory: every character that is not a letter or a digit becomes a dash. */
export const claudeProjectSlug = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, '-');

/*
 * Where the subagents of a session keep their transcripts. The folder of the chat's own directory
 * first; a slug the CLI wrote differently (or a session resumed from somewhere else) is found by the
 * session id alone, which is unique across every project.
 */
export const findSubagentsDir = async (projectsDir: string, cwd: string, sessionId: string): Promise<string | null> => {
    if (projectsDir === '' || sessionId.includes('/') || sessionId.includes('..')) {
        return null;
    }
    const own = join(projectsDir, claudeProjectSlug(cwd), sessionId, 'subagents');
    if (existsSync(own)) {
        return own;
    }
    let dirs: string[];
    try {
        dirs = await readdir(projectsDir);
    } catch {
        return null;
    }
    for (const dir of dirs) {
        const candidate = join(projectsDir, dir, sessionId, 'subagents');
        if (existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
};

/* Every meta file in a subagents folder that says which agent it is about; one that does not parse is left out. */
export const readSubagentMetas = async (dir: string): Promise<SubagentMeta[]> => {
    let names: string[];
    try {
        names = await readdir(dir);
    } catch {
        return [];
    }
    const metas: SubagentMeta[] = [];
    for (const name of names) {
        const match = /^agent-(.+)\.meta\.json$/.exec(name);
        if (!match) {
            continue;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(await readFile(join(dir, name), 'utf8'));
        } catch {
            continue;
        }
        if (!isRecord(parsed)) {
            continue;
        }
        const agentId = match[1]!;
        metas.push({
            agentId,
            toolUseId: str(parsed.toolUseId),
            parentAgentId: str(parsed.parentAgentId),
            description: str(parsed.description),
            transcript: join(dir, `agent-${agentId}.jsonl`)
        });
    }
    return metas;
};

/*
 * The transcript of one agent a workflow started. Claude Code 2.1.282 keeps a folder per run under
 * `workflows` in the subagents folder, and nothing but the agent id ties an agent to its run.
 */
export const findWorkflowAgent = async (subagentsDir: string, agentId: string): Promise<SubagentMeta | null> => {
    if (!/^[\w-]+$/.test(agentId)) {
        return null;
    }
    const workflowsDir = join(subagentsDir, 'workflows');
    let runs: string[];
    try {
        runs = await readdir(workflowsDir);
    } catch {
        return null;
    }
    for (const run of runs) {
        const dir = join(workflowsDir, run);
        const transcript = join(dir, `agent-${agentId}.jsonl`);
        if (existsSync(transcript)) {
            return { agentId, toolUseId: null, parentAgentId: null, description: null, transcript };
        }
    }
    return null;
};

/*
 * One subagent transcript as thread items, read on from where the last read stopped: a transcript only
 * grows, and a panel that follows a working agent asks again every time a line lands. The lines have
 * the envelope of the main transcript, so an assistant or a tool result goes through the same mapping
 * the live stream does. A file that shrank or was rewritten is read again from the start under a new
 * thread, whose cursors then no longer match, so a client holding one is told the history expired.
 */
export class TranscriptProjection {
    readonly path: string;
    private thread!: ChatThread;
    private projector!: ThreadProjector;
    private protocol!: ClaudeProtocol;
    private offset = 0;
    private size = 0;
    private mtimeMs = 0;
    private lineTime = 0;

    constructor(path: string) {
        this.path = path;
        this.reset();
    }

    /* Reads what was added since the last call; false when the file is not there. */
    async refresh(): Promise<boolean> {
        let info: { size: number; mtimeMs: number };
        try {
            info = await stat(this.path);
        } catch {
            return false;
        }
        if (info.size < this.size || info.mtimeMs < this.mtimeMs) {
            this.reset();
        }
        this.size = info.size;
        this.mtimeMs = info.mtimeMs;
        if (info.size > this.offset) {
            this.offset = await readLines(this.path, this.offset, info.size, CHUNK_BYTES, (line) => this.take(line));
        }
        return true;
    }

    items(): ChatItem[] {
        return this.thread.list().map(settledReading);
    }

    /* The page before `cursor`, or the newest page without one; the cursors are the thread's own. */
    page(limit: number, cursor?: string): ChatHistoryResult {
        const page = this.thread.history(limit, cursor);
        return { items: page.items.map(settledReading), history: page.history };
    }

    private reset(): void {
        const reading = readingThread('Claude', () => this.lineTime);
        this.thread = reading.thread;
        this.projector = reading.projector;
        this.protocol = new ClaudeProtocol();
        this.offset = 0;
        this.size = 0;
        this.mtimeMs = 0;
    }

    private take(line: string): void {
        if (line.trim() === '') {
            return;
        }
        let entry: unknown;
        try {
            entry = JSON.parse(line);
        } catch {
            return;
        }
        if (!isRecord(entry) || (entry.type !== 'user' && entry.type !== 'assistant')) {
            return;
        }
        const time = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : Number.NaN;
        if (Number.isFinite(time)) {
            this.lineTime = time;
        }
        const message = isRecord(entry.message) ? entry.message : {};
        const said = entry.type === 'user' ? spokenText(message.content) : null;
        if (said !== null) {
            // The prompt it was given, or a message sent to it later; a reminder the CLI slipped in is not somebody talking.
            if (entry.isMeta !== true && said.trim() !== '') {
                this.thread.upsert({
                    id: `user-${str(entry.uuid) ?? this.thread.list().length}`,
                    kind: 'user',
                    createdAt: this.lineTime,
                    turnId: null,
                    text: said
                });
            }
            return;
        }
        for (const event of this.protocol.handle({ type: entry.type, message })) {
            this.projector.project(0, event);
        }
    }
}
