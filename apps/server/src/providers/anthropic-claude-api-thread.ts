import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { claudeProjectSlug } from '@adecore/agents/chat';
import { writeAtomicSync } from '@adecore/utils/fs';
import { z } from 'zod';

/* The Claude Code whose `--resume` read this transcript format; the file is undocumented. */
const CLAUDE_TRANSCRIPT_CHECKED = '2.1.318';

// What Claude Code writes for a message no model sent; the usage page and the CLI's token count skip it, so old turns are not billed twice.
const NO_MODEL = '<synthetic>';

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOTE =
    '[Ruimte: this conversation ran on the Anthropic API before these chats moved to Claude Code. Your earlier replies hold their tool calls and results as text. Those ran then, so check the files before you assume, and call your tools as usual instead of writing a call as text.]';

const BlockSchema = z.union([
    z.object({ type: z.literal('text'), text: z.string() }),
    z.object({ type: z.literal('tool_use'), name: z.string(), input: z.unknown() }),
    z.object({ type: z.literal('tool_result'), content: z.string(), is_error: z.boolean().optional() }),
    // Bound to the model that signed it, and no part of what was said.
    z.object({ type: z.enum(['thinking', 'redacted_thinking']) })
]);

const ThreadSchema = z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.union([z.string(), z.array(BlockSchema)]) }));
type Thread = z.infer<typeof ThreadSchema>;
type Block = z.infer<typeof BlockSchema>;

interface Exchange {
    prompt: string;
    reply: string[];
}

function replyText(block: Block): string | null {
    switch (block.type) {
        case 'text':
            return block.text;
        case 'tool_use':
            return `[Tool call: ${block.name} ${JSON.stringify(block.input)}]`;
        case 'tool_result':
            return `[Tool ${block.is_error === true ? 'error' : 'result'}: ${block.content}]`;
        default:
            return null;
    }
}

/*
 * One exchange per thing a person said, tool rounds folded into the reply: a tool result the API carried in a user
 * message would read as the person's words once it is text.
 */
function exchangesOf(thread: Thread): Exchange[] {
    const exchanges: Exchange[] = [];

    for (const { role, content } of thread) {
        const blocks: Block[] = typeof content === 'string' ? [{ type: 'text', text: content }] : content;

        if (role === 'assistant') {
            exchanges.at(-1)?.reply.push(...blocks.flatMap((block) => replyText(block) ?? []));
            continue;
        }

        // The results of a stopped turn share their message with the next prompt, and belong to the reply before it.
        exchanges.at(-1)?.reply.push(...blocks.flatMap((block) => (block.type === 'tool_result' ? (replyText(block) ?? []) : [])));
        const prompt = blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n\n');

        if (prompt !== '') {
            exchanges.push({ prompt, reply: [] });
        }
    }

    return exchanges;
}

function transcriptOf(thread: Thread, session: { sessionId: string; cwd: string; at: Date }): string {
    const { sessionId, cwd, at } = session;
    const timestamp = at.toISOString();
    const lines: string[] = [];
    let parentUuid: string | null = null;

    const add = (type: 'user' | 'assistant', message: object): void => {
        const uuid = randomUUID();
        lines.push(
            JSON.stringify({
                parentUuid,
                isSidechain: false,
                type,
                message,
                uuid,
                timestamp,
                userType: 'external',
                cwd,
                sessionId,
                version: CLAUDE_TRANSCRIPT_CHECKED
            })
        );
        parentUuid = uuid;
    };

    exchangesOf(thread).forEach(({ prompt, reply }, index) => {
        add('user', { role: 'user', content: index === 0 ? `${NOTE}\n\n${prompt}` : prompt });

        if (reply.length > 0) {
            add('assistant', {
                id: randomUUID(),
                type: 'message',
                role: 'assistant',
                model: NO_MODEL,
                content: [{ type: 'text', text: reply.join('\n\n') }],
                stop_reason: 'end_turn',
                stop_sequence: null,
                usage: { input_tokens: 0, output_tokens: 0 }
            });
        }
    });

    return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function resolved(cwd: string): string {
    try {
        return realpathSync(cwd);
    } catch {
        return cwd;
    }
}

interface AdoptThreadInput {
    /* Where the daemon kept each thread as `<session id>.json`. */
    threadsDir: string;
    projectsDir: string;
    cwd: string;
    sessionId: string;
}

/*
 * Writes the thread a chat from before Claude Code has under its session id as a Claude Code transcript, so a resume
 * goes on with what was said and the CLI compacts it like any other. The thread stays, and the next start finds the
 * transcript. False when there is no thread to take over.
 */
export function adoptThread(input: AdoptThreadInput): boolean {
    const { threadsDir, projectsDir, cwd, sessionId } = input;

    if (!SESSION_ID.test(sessionId)) {
        return false;
    }

    const path = join(threadsDir, `${sessionId}.json`);
    let transcript: string;

    try {
        const thread = ThreadSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
        transcript = transcriptOf(thread, { sessionId, cwd, at: statSync(path).mtime });
    } catch {
        return false;
    }

    if (transcript === '') {
        return false;
    }

    // Claude Code runs in the resolved folder, so that is the one it looks under.
    const folder = join(projectsDir, claudeProjectSlug(resolved(cwd)));
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    writeAtomicSync(join(folder, `${sessionId}.jsonl`), transcript);

    return true;
}
