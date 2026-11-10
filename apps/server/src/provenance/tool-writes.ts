import { isAbsolute, resolve } from 'node:path';
import { toolFileEdit, type ToolFileEditPiece } from '@adecore/agents/chat';
import { splitLines } from '@adecore/merge';
import type { ChatToolItem } from '@ruimte/contracts';
import type { WriteSignature } from './runs.ts';

interface ToolWrite {
    path: string;
    signature: WriteSignature;
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

function editBlock(piece: ToolFileEditPiece): WriteSignature['blocks'][number] {
    return { added: splitLines(piece.after), removed: splitLines(piece.before) };
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

    const edit = toolFileEdit(item.name, item.input);

    if (edit === null) {
        return [];
    }

    return [{ path: absolute(cwd, edit.path), signature: edit.write ? { all: true, blocks: [] } : { all: false, blocks: edit.pieces.map(editBlock) } }];
}
