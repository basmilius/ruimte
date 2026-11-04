import { ToolRefusal } from '@adecore/agents/context';
import { z } from 'zod';
import { defineActionTool, runAction } from './action-tool.ts';
import { field, orNote, requiredField } from './host.ts';
import { TAIL_INPUT, defineToolkit } from './tool.ts';

function branchInput(tool: string) {
    return requiredField(`${tool} needs branch, the branch of a worktree; worktree_list lists them`);
}

const worktreeList = defineActionTool('worktree', {
    name: 'worktree_list',
    action: 'worktree.list',
    description: 'Lists the worktrees of the repository.',
    annotations: { readOnly: true },
    input: z.object({}),
    async run(_input, call) {
        const { worktrees } = await runAction(call, 'worktree.list', {});

        return orNote(
            worktrees.map((worktree) =>
                [
                    field(worktree.branch),
                    worktree.path ?? 'missing',
                    worktree.nodes.length === 0 ? '-' : worktree.nodes.join(','),
                    field(worktree.from ?? '-'),
                    String(worktree.changed),
                    String(worktree.untracked),
                    String(worktree.ahead)
                ].join('\t')
            ),
            'This repository has no worktrees'
        );
    }
});

const worktreeDiff = defineActionTool('worktree', {
    name: 'worktree_diff',
    action: 'worktree.diff',
    description: 'Prints what a worktree changed since its base branch.',
    annotations: { readOnly: true },
    input: z.object({ branch: branchInput('worktree_diff'), tail: TAIL_INPUT, stat: z.boolean().optional().describe('One line per file') }),
    async run(input, call) {
        const diff = await runAction(call, 'worktree.diff', { branch: input.branch });
        const since = diff.from ?? 'the base branch';

        if (input.stat === true) {
            return orNote(
                diff.files.map((file) => `file\t${field(file.path)}\t${file.added}\t${file.deleted}`),
                `${input.branch} changed nothing since ${since}`
            );
        }

        const lines = diff.files.flatMap((file) =>
            file.diff === '' ? [`# ${file.path}: ${file.omitted === 'binary' ? 'binary' : 'too large to show'}`] : file.diff.replace(/\n$/, '').split('\n')
        );

        if (lines.length === 0) {
            return [`note\t${input.branch} changed nothing since ${since}`];
        }

        return input.tail === undefined ? lines : lines.slice(-input.tail);
    }
});

const worktreeMerge = defineActionTool('worktree', {
    name: 'worktree_merge',
    action: 'worktree.merge',
    description: 'Merges the worktree of an agent you opened into its base branch.',
    annotations: { destructive: true },
    input: z.object({
        branch: branchInput('worktree_merge'),
        message: z.string().trim().min(1, 'message needs the text of the message').optional().describe('For the commit of uncommitted files and a squash'),
        squash: z.boolean().optional(),
        rebase: z.boolean().optional()
    }),
    async run(input, call) {
        if (input.squash === true && input.rebase === true) {
            throw new ToolRefusal('two-strategies', 'worktree_merge takes squash or rebase, not both');
        }

        const strategy = input.squash === true ? 'squash' : input.rebase === true ? 'rebase' : 'merge';
        const merged = await runAction(call, 'worktree.merge', { branch: input.branch, strategy, message: input.message ?? null });

        return [
            `merged\t${field(merged.branch)}\t${field(merged.into ?? '-')}\t${merged.strategy}`,
            `summary\t${field(merged.summary)}`,
            'kept\tthe worktree and its branch stay until a person removes them'
        ];
    }
});

export const worktreeToolkit = defineToolkit('worktree', [worktreeList, worktreeDiff, worktreeMerge]);
