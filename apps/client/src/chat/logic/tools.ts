import type { ChatToolItem } from '@ruimte/contracts';

export interface FileChange {
    path: string;
    before: string;
    after: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/* The one line that says what a tool call is about: the command, the file, the pattern. */
export const toolSummary = (name: string, input: unknown): string => {
    if (!isRecord(input)) {
        return '';
    }
    switch (name) {
        case 'Bash':
            return str(input.description) ?? str(input.command) ?? '';
        case 'Read':
        case 'Edit':
        case 'Write':
        case 'MultiEdit':
        case 'NotebookEdit':
            return str(input.file_path) ?? str(input.notebook_path) ?? '';
        case 'Grep':
        case 'Glob':
            return str(input.pattern) ?? '';
        case 'WebFetch':
        case 'WebSearch':
            return str(input.url) ?? str(input.query) ?? '';
        case 'Task':
        case 'Agent':
            return str(input.description) ?? '';
        case 'Skill':
            return str(input.skill) ?? '';
        default: {
            const first = Object.values(input).find((value) => typeof value === 'string');
            return typeof first === 'string' ? first : '';
        }
    }
};

/* The before and after text of a file-changing tool call, so the thread can show it as a diff. */
export const fileChanges = (name: string, input: unknown): FileChange[] => {
    if (!isRecord(input)) {
        return [];
    }
    const path = str(input.file_path) ?? '';
    if (name === 'Edit') {
        return [{ path, before: str(input.old_string) ?? '', after: str(input.new_string) ?? '' }];
    }
    if (name === 'Write') {
        return [{ path, before: '', after: str(input.content) ?? '' }];
    }
    if (name === 'MultiEdit' && Array.isArray(input.edits)) {
        return input.edits.filter(isRecord).map((edit) => ({ path, before: str(edit.old_string) ?? '', after: str(edit.new_string) ?? '' }));
    }
    return [];
};

export const isFileChange = (name: string): boolean => name === 'Edit' || name === 'Write' || name === 'MultiEdit';

/* When a running call started: what the CLI reported, or the moment the call appeared. */
export const toolStartedAt = (tool: ChatToolItem): number => tool.progress?.startedAt ?? tool.createdAt;

// Partial output is a tail: what the command says now matters more than what it said first.
const LIVE_OUTPUT_LINES = 12;

/* The last lines of a running call's output, or null when the provider streams none. */
export const liveOutput = (tool: ChatToolItem): string | null => {
    const output = tool.progress?.output;
    if (!output) {
        return null;
    }
    const lines = output.replace(/\n$/, '').split('\n');
    return lines.slice(-LIVE_OUTPUT_LINES).join('\n');
};

/* "12s", "2m 5s": how long a call has been running, for the live row. */
export const formatElapsed = (ms: number): string => {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    if (seconds < 60) {
        return `${seconds}s`;
    }
    const rest = seconds % 60;
    return rest === 0 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 60)}m ${rest}s`;
};
