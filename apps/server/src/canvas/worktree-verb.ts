import { z } from 'zod';
import { defineActionVerb, runAction } from './action-verb.ts';
import { VerbRefusal, defineNoun, field, orNote } from './verb.ts';

const BRANCH_TEXT = 'The branch of the worktree, from ruimte-context worktree list';

const listSub = defineActionVerb('worktree', {
    name: 'list',
    action: 'worktree.list',
    usage: '',
    params: [],
    detail: [
        'prints\tbranch\tpath\tnodes\tfrom\tchanged\tnew\tcommits\tone line per worktree',
        'nodes\tThe node the worktree was made for and every terminal or chat working in it, comma separated; a dash when none is left',
        'from\tThe branch it was made from, which its commits are counted against; a dash for a worktree made outside Ruimte',
        'counts\tchanged: uncommitted tracked files; new: untracked files; commits: commits the from branch does not have',
        'missing\tA worktree whose folder is gone prints missing in the path column',
        'see\truimte-context worktree diff\twhat one of them changed'
    ],
    positionals: z.tuple([], { error: 'worktree list takes no arguments' }),
    flags: z.object({}),
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

const diffSub = defineActionVerb('worktree', {
    name: 'diff',
    action: 'worktree.diff',
    usage: '<branch> [--stat] [--tail N]',
    params: [
        { syntax: '<branch>', need: 'required', field: 'branch', text: BRANCH_TEXT },
        { syntax: '--stat', need: 'no value', text: 'Only one line per file: file, path, lines added, lines removed' },
        { syntax: '--tail N', need: 'optional', text: 'Only the last N lines of the diff, N a positive whole number' }
    ],
    detail: [
        'prints\tThe unified diff of every file, as text; a file too large or binary is one line saying so',
        'measure\tAgainst where the worktree left its from branch, so commits that branch gained since are not in it'
    ],
    positionals: z.tuple([z.string().min(1, 'worktree diff needs the branch of a worktree')], {
        error: (issue) => (issue.code === 'too_big' ? 'worktree diff takes one branch and nothing else' : 'worktree diff needs the branch of a worktree')
    }),
    flags: z.object({
        tail: z.coerce
            .number({ error: '--tail needs a positive whole number' })
            .int('--tail needs a positive whole number')
            .positive('--tail needs a positive whole number')
            .optional()
    }),
    switches: ['stat'],
    async run({ positionals: [branch], flags, switches }, call) {
        const diff = await runAction(call, 'worktree.diff', { branch });
        const since = diff.from ?? 'the base branch';
        if (switches.has('stat')) {
            return orNote(
                diff.files.map((file) => `file\t${field(file.path)}\t${file.added}\t${file.deleted}`),
                `${branch} changed nothing since ${since}`
            );
        }
        const lines = diff.files.flatMap((file) =>
            file.diff === '' ? [`# ${file.path}: ${file.omitted === 'binary' ? 'binary' : 'too large to show'}`] : file.diff.replace(/\n$/, '').split('\n')
        );
        if (lines.length === 0) {
            return [`note\t${branch} changed nothing since ${since}`];
        }
        return flags.tail === undefined ? lines : lines.slice(-flags.tail);
    }
});

const mergeSub = defineActionVerb('worktree', {
    name: 'merge',
    action: 'worktree.merge',
    usage: '<branch> [--squash | --rebase] [--message M]',
    params: [
        { syntax: '<branch>', need: 'required', field: 'branch', text: BRANCH_TEXT },
        { syntax: '--squash', need: 'no value', text: 'One commit on the target with the message; without a strategy flag the merge writes a merge commit' },
        { syntax: '--rebase', need: 'no value', text: 'The commits put on top of the target and the target fast-forwarded' },
        { syntax: '--message M', need: 'optional', field: 'message' }
    ],
    detail: [
        'prints\tmerged\tbranch\tinto\tstrategy\tthen summary, then kept with who removes the worktree',
        'rule\tOnly a worktree made for an agent you opened, or one opened by an agent you opened',
        'rule\tOnly into a checkout without uncommitted changes to tracked files: the merge lands in a folder a person works in',
        'rule\tA conflict is taken back at once and refused with the files; resolving it is for a person, or for the agent again in its worktree',
        'rule\tAn agent still in a turn in the worktree is refused; no agent is ever stopped by a merge',
        'rule\tUncommitted and new files in the worktree are committed first, so the merge never takes half of the work',
        'never\tRemoving the worktree or its branch, merged or not: both stay until a person removes them'
    ],
    positionals: z.tuple([z.string().min(1, 'worktree merge needs the branch of a worktree')], {
        error: (issue) => (issue.code === 'too_big' ? 'worktree merge takes one branch and nothing else' : 'worktree merge needs the branch of a worktree')
    }),
    flags: z.object({ message: z.string().trim().min(1, '--message needs the text of the message').optional() }),
    switches: ['squash', 'rebase'],
    async run({ positionals: [branch], flags, switches }, call) {
        if (switches.has('squash') && switches.has('rebase')) {
            throw new VerbRefusal('two-strategies', 'worktree merge takes --squash or --rebase, not both');
        }
        const strategy = switches.has('squash') ? 'squash' : switches.has('rebase') ? 'rebase' : 'merge';
        const merged = await runAction(call, 'worktree.merge', { branch, strategy, message: flags.message ?? null });
        return [
            `merged\t${field(merged.branch)}\t${field(merged.into ?? '-')}\t${merged.strategy}`,
            `summary\t${field(merged.summary)}`,
            'kept\tthe worktree and its branch stay until a person removes them'
        ];
    }
});

export const worktreeVerb = defineNoun({
    name: 'worktree',
    summary: 'Reads the worktrees of the repository and what each changed, and merges the ones of agents you opened',
    detail: [
        'worktrees\tagent --worktree and team --worktree give each agent a worktree of its own; these are the words to see and bring back their work',
        'never\tNothing removes a worktree on its own, also not after a merge; a person removes it from the git panel or when deleting its node'
    ],
    actions: [listSub, diffSub, mergeSub]
});
