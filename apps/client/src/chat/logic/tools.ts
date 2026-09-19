import type { ChatFileChange, ChatToolItem } from '@ruimte/contracts';
import { toolEntry } from './tool-catalog';

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
    const known = toolEntry(name);
    if (known === undefined) {
        // A tool nobody wrote down, an MCP one above all: the first string it was given is the best guess there is.
        const first = Object.values(input).find((value) => typeof value === 'string');
        return typeof first === 'string' ? first : '';
    }
    for (const key of known.summary) {
        const value = str(input[key]);
        if (value !== null) {
            return value;
        }
    }
    return '';
};

// What `GET /fs/file` will serve; a path with another suffix is not worth asking the daemon about.
const IMAGE_SUFFIXES = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

/* The image file a tool call looked at, so the row can draw it; null for every other call. */
export const readImagePath = (name: string, input: unknown): string | null => {
    if (toolEntry(name)?.readsImage !== true) {
        return null;
    }
    const path = isRecord(input) ? str(input.file_path) : null;
    if (path === null) {
        return null;
    }
    const lowered = path.toLowerCase();
    return IMAGE_SUFFIXES.some((suffix) => lowered.endsWith(suffix)) ? path : null;
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

export const isFileChange = (name: string): boolean => toolEntry(name)?.changesFiles === true;

/* The unified diffs a provider put next to a tool call; empty for one that reports before and after. */
export const unifiedChanges = (tool: ChatToolItem): ChatFileChange[] => (tool.changes ?? []).filter((change) => change.diff !== '');

/* The same, for the copy an approval carries so the person can read what they are approving. */
export const approvalChanges = (input: unknown): ChatFileChange[] => {
    const changes = isRecord(input) ? input.changes : null;
    if (!Array.isArray(changes)) {
        return [];
    }
    return changes.filter(
        (change): change is ChatFileChange => isRecord(change) && typeof change.path === 'string' && typeof change.diff === 'string' && change.diff !== ''
    );
};

/* Whether a settled call is worth a row in the turn's changed files card. */
export const hasFileChanges = (tool: ChatToolItem): boolean => unifiedChanges(tool).length > 0 || fileChanges(tool.name, tool.input).length > 0;

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
