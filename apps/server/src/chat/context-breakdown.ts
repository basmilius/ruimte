import { attachmentImageMime, type ChatContextBreakdown, type ChatItem } from '@ruimte/contracts';

// A rough rate for prose and code alike; scaling to the CLI's own total absorbs the error.
const CHARS_PER_TOKEN = 4;

// What a model is charged for a picture at the size a CLI sends it, whatever its bytes on disk.
const IMAGE_TOKENS = 1_600;

// Tools whose result is a file's contents. An MCP tool is named `<server>/<tool>`, so only the last part counts.
const READ_TOOLS = new Set(['Read', 'NotebookRead', 'View', 'read_file', 'read_text_file', 'read_multiple_files']);

const isReadTool = (name: string): boolean => READ_TOOLS.has(name.slice(name.lastIndexOf('/') + 1));

const textTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

const inputTokens = (input: unknown): number => {
    if (input === undefined || input === null) {
        return 0;
    }
    return textTokens(typeof input === 'string' ? input : JSON.stringify(input));
};

/*
 * What the context of the last request is made of, estimated from the thread and scaled to the
 * total the CLI reported. A subagent's own work never reached the main context, only its prompt and
 * its report did, and nothing before the last compaction survived it. Thinking is left out: a CLI
 * does not carry it into the next request.
 */
export const estimateContextBreakdown = (items: readonly ChatItem[], contextTokens: number): ChatContextBreakdown => {
    let toolOutput = 0;
    let filesRead = 0;
    let conversation = 0;
    const start = items.findLastIndex((item) => item.kind === 'compaction') + 1;
    for (const item of items.slice(start)) {
        switch (item.kind) {
            case 'user':
                conversation += textTokens(item.text);
                filesRead += (item.attachments ?? []).filter((attachment) => attachmentImageMime(attachment) !== null).length * IMAGE_TOKENS;
                break;
            case 'assistant':
                if (!item.parentToolUseId) {
                    conversation += textTokens(item.text);
                }
                break;
            case 'tool': {
                if (item.parentToolUseId !== null) {
                    break;
                }
                const tokens = inputTokens(item.input) + textTokens(item.output ?? item.progress?.output ?? '');
                if (isReadTool(item.name)) {
                    filesRead += tokens;
                } else {
                    toolOutput += tokens;
                }
                break;
            }
            case 'subagent':
                // A row a `--task` opened stands for a node; the verb call that made it is a tool row of its own.
                if (item.origin !== 'ruimte') {
                    toolOutput += textTokens(item.prompt ?? '') + textTokens(item.result ?? '');
                }
                break;
            default:
                break;
        }
    }
    const total = Math.max(0, Math.round(contextTokens));
    const estimated = toolOutput + filesRead + conversation;
    const scale = estimated > total ? total / estimated : 1;
    const parts = {
        toolOutput: Math.floor(toolOutput * scale),
        filesRead: Math.floor(filesRead * scale),
        conversation: Math.floor(conversation * scale)
    };
    return { ...parts, system: Math.max(0, total - parts.toolOutput - parts.filesRead - parts.conversation) };
};
