import type { ChatFileChange, ChatToolItem } from '@ruimte/agent-contracts';
import { isRecord } from './json';
import { toolEntry } from './tool-catalog';

export interface FileChange {
    path: string;
    before: string;
    after: string;
}

function str(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

/* The one line that says what a tool call is about: the command, the file, the pattern. */
export function toolSummary(name: string, input: unknown): string {
    if (!isRecord(input)) {
        return '';
    }
    const known = toolEntry(name);
    if (known === undefined) {
        // A tool nobody wrote down, an MCP one above all, gets its best guess from the first string it was given.
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
}

// What `GET /fs/file` will serve; a path with another suffix is not worth asking the host about.
const IMAGE_SUFFIXES = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

/* The image file a tool call looked at, so the row can draw it; null for every other call. */
export function readImagePath(name: string, input: unknown): string | null {
    if (toolEntry(name)?.readsImage !== true) {
        return null;
    }
    const path = isRecord(input) ? str(input.file_path) : null;
    if (path === null) {
        return null;
    }
    const lowered = path.toLowerCase();
    return IMAGE_SUFFIXES.some((suffix) => lowered.endsWith(suffix)) ? path : null;
}

/* The before and after text of a file-changing tool call, so the thread can show it as a diff. */
export function fileChanges(name: string, input: unknown): FileChange[] {
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
}

export function isFileChange(name: string): boolean {
    return toolEntry(name)?.changesFiles === true;
}

/* The unified diffs a provider put next to a tool call; empty for one that reports before and after. */
export function unifiedChanges(tool: ChatToolItem): ChatFileChange[] {
    return (tool.changes ?? []).filter((change) => change.diff !== '');
}

/* The same, for the copy an approval carries so the person can read what they are approving. */
export function approvalChanges(input: unknown): ChatFileChange[] {
    const changes = isRecord(input) ? input.changes : null;
    if (!Array.isArray(changes)) {
        return [];
    }
    return changes.filter(
        (change): change is ChatFileChange => isRecord(change) && typeof change.path === 'string' && typeof change.diff === 'string' && change.diff !== ''
    );
}

/* Whether a settled call is worth a row in the turn's changed files card. */
export function hasFileChanges(tool: ChatToolItem): boolean {
    return unifiedChanges(tool).length > 0 || fileChanges(tool.name, tool.input).length > 0;
}

/* When a running call started: what the CLI reported, or the moment the call appeared. */
export function toolStartedAt(tool: ChatToolItem): number {
    return tool.progress?.startedAt ?? tool.createdAt;
}

// Keep the full buffer so the renderer can carry ANSI state into the visible tail.
export function liveOutput(tool: ChatToolItem): string | null {
    return tool.progress?.output || null;
}
