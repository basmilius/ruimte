import { isAbsolute, resolve } from 'node:path';
import { splitLines } from '@adecore/merge';
import type { ChatToolItem } from '@ruimte/contracts';
import type { WriteSignature } from './runs.ts';

/* A file a finished tool call wrote, and what the call says about the lines. */
export interface ToolWrite {
    path: string;
    signature: WriteSignature;
}

function text(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function record(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function absolute(cwd: string, path: string): string {
    return isAbsolute(path) ? path : resolve(cwd, path);
}

/* The lines a unified diff adds and removes, one block per hunk. The `---` and `+++` headers sit before the first `@@`. */
function blocksOfDiff(diff: string): WriteSignature['blocks'] {
    const blocks: WriteSignature['blocks'] = [];
    let current: WriteSignature['blocks'][number] | null = null;
    for (const line of diff.split(/\r?\n/)) {
        if (line.startsWith('@@')) {
            current = { added: [], removed: [] };
            blocks.push(current);
        } else if (current !== null && line.startsWith('+')) {
            current.added.push(line.slice(1));
        } else if (current !== null && line.startsWith('-')) {
            current.removed.push(line.slice(1));
        }
    }
    return blocks;
}

function editBlock(oldText: string | null, newText: string | null): WriteSignature['blocks'][number] {
    return { added: splitLines(newText ?? ''), removed: splitLines(oldText ?? '') };
}

/*
 * The files a tool call wrote, from what the CLI reported: the input of Claude's Edit, Write and
 * MultiEdit (the Apple backend uses the same names), or the changes Codex lists with a unified diff each.
 * Any other tool writes nothing as far as this goes; a shell command is found by the checkpoint.
 */
export function toolWrites(item: Pick<ChatToolItem, 'name' | 'input' | 'changes'>, cwd: string): ToolWrite[] {
    if (item.changes !== undefined && item.changes.length > 0) {
        return item.changes.map((change) => ({
            path: absolute(cwd, change.path),
            signature: change.kind === 'add' || change.diff === '' ? { all: true, blocks: [] } : { all: false, blocks: blocksOfDiff(change.diff) }
        }));
    }
    const input = record(item.input);
    const path = text(input.file_path);
    if (path === null) {
        return [];
    }
    const target = absolute(cwd, path);
    switch (item.name) {
        case 'Write':
            return [{ path: target, signature: { all: true, blocks: [] } }];
        case 'Edit':
            return [{ path: target, signature: { all: false, blocks: [editBlock(text(input.old_string), text(input.new_string))] } }];
        case 'MultiEdit': {
            const edits = Array.isArray(input.edits) ? input.edits.map(record) : [];
            return [{ path: target, signature: { all: false, blocks: edits.map((edit) => editBlock(text(edit.old_string), text(edit.new_string))) } }];
        }
        default:
            return [];
    }
}
