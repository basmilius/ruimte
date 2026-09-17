import { isCanvasView, type ProjectContent, type Worktree } from '@ruimte/contracts';
import { z } from 'zod';
import { GitError } from '../git/run.ts';
import { isInside } from './project-paths.ts';
import { VerbRefusal, defineAction, defineNoun, field, orNote, placeOf, type VerbCall, type WorktreeHost } from './verb.ts';

// How far up the chain of openers a merge looks for the caller; a chain this deep is refused by `agent` long before.
const MAX_LINEAGE = 64;

const hostOf = (call: VerbCall): WorktreeHost => {
    if (call.host.worktrees === undefined) {
        throw new VerbRefusal('not-a-repository', 'This machine has no git to read worktrees with');
    }
    return call.host.worktrees;
};

/* The worktrees of the caller's project, refusing a project outside a repository. */
const worktreesOf = async (call: VerbCall): Promise<{ folder: string; content: ProjectContent; worktrees: Worktree[] }> => {
    const place = placeOf(call);
    if (place.folder === null) {
        throw new VerbRefusal('not-a-repository', 'This project has no folder, so it has no worktrees');
    }
    const [content, worktrees] = await Promise.all([
        call.host.read(place.projectId),
        hostOf(call)
            .list(place.folder)
            .catch((e: unknown) => {
                if (e instanceof GitError && e.code === 'not-a-repo') {
                    throw new VerbRefusal('not-a-repository', `${place.folder} is not in a git repository`);
                }
                throw e;
            })
    ]);
    return { folder: place.folder, content, worktrees };
};

/* The nodes of the project working in a worktree: the one it was made for, and every terminal or chat whose folder is inside it. */
const nodesIn = (content: ProjectContent, worktree: Worktree): string[] => {
    const ids = new Set<string>(worktree.nodeId === undefined ? [] : [worktree.nodeId]);
    for (const view of content.views) {
        if (!isCanvasView(view)) {
            continue;
        }
        for (const node of view.nodes) {
            if ((node.kind === 'terminal' || node.kind === 'chat') && node.cwd !== undefined && !worktree.missing && isInside(worktree.path, node.cwd)) {
                ids.add(node.id);
            }
        }
    }
    return [...ids];
};

const branchLines = (worktrees: readonly Worktree[]): string[] =>
    orNote(
        worktrees.map((worktree) => `worktree\t${field(worktree.branch)}`),
        'This repository has no worktrees'
    );

const named = (worktrees: readonly Worktree[], branch: string): Worktree => {
    const worktree = worktrees.find((candidate) => candidate.branch === branch);
    if (!worktree) {
        throw new VerbRefusal('unknown-worktree', `${branch} is not the branch of a worktree of this repository`, branchLines(worktrees));
    }
    return worktree;
};

/* Whether the caller opened this node, or opened the agent that did, however far down. */
const openedByCaller = (call: VerbCall, nodeId: string): boolean => {
    let current: string | null = nodeId;
    for (let i = 0; i < MAX_LINEAGE && current !== null; i++) {
        current = call.host.madeBy(current);
        if (current === call.caller) {
            return true;
        }
    }
    return false;
};

const listSub = defineAction('worktree', {
    name: 'list',
    usage: '',
    summary: 'Lists the worktrees of the repository: branch, path, nodes, from, changed, new, commits',
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
        const { content, worktrees } = await worktreesOf(call);
        return orNote(
            worktrees.map((worktree) => {
                const nodes = nodesIn(content, worktree);
                return [
                    field(worktree.branch),
                    worktree.missing ? 'missing' : worktree.path,
                    nodes.length === 0 ? '-' : nodes.join(','),
                    field(worktree.from?.branch ?? '-'),
                    String(worktree.work?.changed ?? 0),
                    String(worktree.work?.untracked ?? 0),
                    String(worktree.work?.ahead ?? 0)
                ].join('\t');
            }),
            'This repository has no worktrees'
        );
    }
});

const diffSub = defineAction('worktree', {
    name: 'diff',
    usage: '<branch> [--stat] [--tail N]',
    summary: 'Prints what a worktree changed since the branch it was made from, uncommitted and new files included',
    detail: [
        'argument\t<branch>\trequired\tThe branch of the worktree, from ruimte-context worktree list',
        'flag\t--stat\tno value\tOnly one line per file: file, path, lines added, lines removed',
        'flag\t--tail N\toptional\tOnly the last N lines of the diff, N a positive whole number',
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
        const { worktrees } = await worktreesOf(call);
        const worktree = named(worktrees, branch);
        if (worktree.missing) {
            throw new VerbRefusal('worktree-missing', `The folder of ${branch} is gone, so there is nothing to diff`);
        }
        const diff = await hostOf(call).diff(worktree.path, worktree.from?.branch ?? worktree.from?.commit);
        const files = diff.files ?? [];
        if (switches.has('stat')) {
            return orNote(
                files.map((file) => `file\t${field(file.path)}\t${file.added}\t${file.deleted}`),
                `${branch} changed nothing since ${worktree.from?.branch ?? 'the base branch'}`
            );
        }
        const lines = files.flatMap((file) =>
            file.diff === '' ? [`# ${file.path}: ${file.omitted === 'binary' ? 'binary' : 'too large to show'}`] : file.diff.replace(/\n$/, '').split('\n')
        );
        if (lines.length === 0) {
            return [`note\t${branch} changed nothing since ${worktree.from?.branch ?? 'the base branch'}`];
        }
        return flags.tail === undefined ? lines : lines.slice(-flags.tail);
    }
});

const mergeSub = defineAction('worktree', {
    name: 'merge',
    usage: '<branch> [--squash | --rebase] [--message M]',
    summary: 'Merges the worktree of an agent you opened into the branch it was made from; the worktree and its branch stay',
    detail: [
        'argument\t<branch>\trequired\tThe branch of the worktree, from ruimte-context worktree list',
        'flag\t--squash\tno value\tOne commit on the target with the message; without a strategy flag the merge writes a merge commit',
        'flag\t--rebase\tno value\tThe commits put on top of the target and the target fast-forwarded',
        'flag\t--message M\toptional\tThe message of the commit made of uncommitted files, and of a squash; without it the title of the node',
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
        const { folder, content, worktrees } = await worktreesOf(call);
        const worktree = named(worktrees, branch);
        const owner = worktree.nodeId;
        if (owner === undefined || !openedByCaller(call, owner)) {
            throw new VerbRefusal(
                'not-yours',
                `${branch} was made for ${owner ?? 'no agent'}, and worktree merge only merges the worktree of an agent you opened`,
                [`made for\t${owner ?? '-'}`, `you\t${call.caller}`, 'person\tA person merges any worktree from the git panel']
            );
        }
        const strategy = switches.has('squash') ? 'squash' : switches.has('rebase') ? 'rebase' : 'merge';
        const title = content.views.flatMap((view) => (isCanvasView(view) ? view.nodes : [])).find((node) => node.id === owner)?.title ?? branch;
        try {
            const result = await hostOf(call).merge({
                repo: folder,
                path: worktree.path,
                strategy,
                subject: flags.message ?? `${title}: work of the agent`
            });
            return [
                `merged\t${field(branch)}\t${field(result.into ?? '-')}\t${strategy}`,
                `summary\t${field(result.summary)}`,
                'kept\tthe worktree and its branch stay until a person removes them'
            ];
        } catch (e) {
            if (e instanceof GitError) {
                throw new VerbRefusal(e.code, e.message);
            }
            throw e;
        }
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
