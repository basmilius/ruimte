import { rm, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { GitActionPhase, WorktreeMergePayload, WorktreeMergeResult } from '@ruimte/contracts';
import type { ProgressSink } from './actions.ts';
import { resolveBase } from './status.ts';
import { GitError, git, runGit, streamGit } from './run.ts';
import type { Worktrees } from './worktrees.ts';
import { PROJECT_DIR } from '../projects/project-files.ts';
import { errorText } from '../error-text.ts';

/* One agent whose folder is inside a worktree. */
export interface WorktreeAgent {
    nodeId: string;
    /* In a turn right now. */
    working: boolean;
    /* A CLI or shell is running for it, in a turn or not. */
    live: boolean;
}

export interface WorktreeAgents {
    /* The agents working in a folder: chats and terminals whose cwd is in it, and the node the worktree was made for. */
    in(path: string, nodeId: string | undefined): WorktreeAgent[];
    /* Stops a node the way stopping it by hand does, and resolves once its CLI or shell was told to end. */
    stop(nodeId: string): Promise<void>;
}

/*
 * Settings a person may have that would change what a merge does behind the dialog's back: stash
 * their work, resolve a conflict from memory without saying so, open an editor nobody can see, refuse
 * a merge commit or a squash, or fold and reorder commits in a rebase. Hooks and signing stay the
 * person's: a hook that refuses is git's answer in git's words.
 */
const settingsFor = (into: string): string[] =>
    [
        'merge.autoStash=false',
        'rebase.autoStash=false',
        'rerere.enabled=false',
        'core.editor=true',
        'merge.ff=true',
        `branch.${into}.mergeOptions=`,
        'rebase.updateRefs=false',
        'rebase.autoSquash=false',
        'rebase.rebaseMerges=false'
    ].flatMap((setting) => ['-c', setting]);

/* What the agent verb holds a merge to on top of what a person's merge is held to. */
export interface MergeLimits {
    /* Refuses a target checkout with uncommitted changes to tracked files. */
    cleanTarget?: boolean;
    /* Takes a conflicting merge back and refuses, instead of leaving it for a person. */
    abortOnConflict?: boolean;
}

const exists = (path: string): Promise<boolean> =>
    stat(path).then(
        () => true,
        () => false
    );

class Job {
    canceled = false;
}

/* The files git left unmerged in a checkout, one per path. */
export const conflictedFiles = async (cwd: string): Promise<string[]> => {
    const output = await git(['diff', '--name-only', '--diff-filter=U', '-z'], cwd);
    return output === null ? [] : [...new Set(output.split('\0').filter((path) => path !== ''))];
};

/* Whether git has a file of its own in a checkout's git dir, such as MERGE_HEAD. */
const gitPathExists = async (cwd: string, name: string): Promise<boolean> => {
    const found = (await git(['rev-parse', '--git-path', name], cwd))?.trim();
    return found !== undefined && found !== '' && (await exists(isAbsolute(found) ? found : join(cwd, found)));
};

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/*
 * Merge through the target checkout under the repository lock, never by moving its ref. Dirty work
 * must be committed explicitly, conflicts remain for the person, and nothing is stashed implicitly.
 */
export class WorktreeMerge {
    private readonly running = new Map<string, Job>();
    private readonly worktrees: Worktrees;
    private readonly agents: WorktreeAgents;

    constructor(worktrees: Worktrees, agents: WorktreeAgents) {
        this.worktrees = worktrees;
        this.agents = agents;
    }

    /* Stops a merge before its next step; the merge step itself runs to its end once started. */
    cancel(actionId: string): void {
        const job = this.running.get(actionId);
        if (job) {
            job.canceled = true;
        }
    }

    async merge(payload: WorktreeMergePayload, sink: ProgressSink, limits: MergeLimits = {}): Promise<WorktreeMergeResult> {
        const job = new Job();
        this.running.set(payload.actionId, job);
        try {
            return await this.worktrees.exclusive(payload.repo, (main) => this.perform(main, payload, sink, job, limits));
        } catch (e) {
            sink('failed', errorText(e));
            throw e;
        } finally {
            this.running.delete(payload.actionId);
        }
    }

    /*
     * Takes back a merge or squash that stopped on a conflict. `merge --abort` needs the MERGE_HEAD a
     * squash never writes, so a squash goes back with `reset --merge`, which keeps what the person
     * had changed and not added.
     */
    async abort(cwd: string): Promise<void> {
        if (await gitPathExists(cwd, 'MERGE_HEAD')) {
            const aborted = await runGit(['merge', '--abort'], cwd);
            if (aborted.code !== 0) {
                throw new GitError('git-failed', aborted.stderr.trim() || 'git merge --abort failed');
            }
            return;
        }
        if ((await gitPathExists(cwd, 'SQUASH_MSG')) && (await conflictedFiles(cwd)).length > 0) {
            const reset = await runGit(['reset', '--merge'], cwd);
            if (reset.code !== 0) {
                throw new GitError('git-failed', reset.stderr.trim() || 'git reset --merge failed');
            }
            // Left behind, the message would open as the draft of the person's next commit.
            const message = (await git(['rev-parse', '--git-path', 'SQUASH_MSG'], cwd))?.trim();
            if (message) {
                await rm(isAbsolute(message) ? message : join(cwd, message), { force: true });
            }
            return;
        }
        throw new GitError('git-failed', 'No merge waits halfway in this checkout.');
    }

    private async perform(main: string, payload: WorktreeMergePayload, sink: ProgressSink, job: Job, limits: MergeLimits): Promise<WorktreeMergeResult> {
        const output: string[] = [];
        let settings: string[] = [];
        const step = async (phase: GitActionPhase, args: string[], cwd: string): Promise<{ code: number; text: string }> => {
            if (job.canceled) {
                throw new GitError('git-failed', 'The merge was canceled.');
            }
            sink(phase, '');
            const result = await streamGit([...settings, ...args], cwd, { onLine: (line) => sink(phase, line) });
            const text = `${result.stdout}${result.stderr}`.trim();
            output.push(text);
            return { code: result.code, text };
        };
        const must = async (phase: GitActionPhase, args: string[], cwd: string): Promise<string> => {
            const { code, text } = await step(phase, args, cwd);
            if (code !== 0) {
                throw new GitError('git-failed', text || `git ${args[0]} failed`);
            }
            return text;
        };

        const state = await this.worktrees.describe(main, payload.path);
        const { entry, record, label } = state;
        if (entry === null || state.missing) {
            throw new GitError('worktree-missing', `The folder of ${label} is gone, so there is nothing to merge from it. Remove it instead.`);
        }
        if (entry.branch === null) {
            throw new GitError('no-branch', `${entry.path} is on a detached HEAD; only a branch can be merged.`);
        }
        const branch = entry.branch;
        if (state.work.operation !== undefined) {
            throw new GitError('worktree-busy', `A ${state.work.operation} stopped halfway in ${branch}. Finish or abort it there first.`);
        }

        const into = payload.into ?? record?.from.branch ?? (await this.localBase(main));
        if (into === null) {
            throw new GitError('target-not-checked-out', `${branch} was not made from a branch, so name the branch to merge it into.`);
        }
        if (into === branch) {
            throw new GitError('target-not-checked-out', `${branch} cannot be merged into itself.`);
        }
        const checkouts = await this.worktrees.checkouts(main);
        const target = checkouts.find((checkout) => checkout.branch === into && checkout.path !== entry.path);
        if (target === undefined) {
            const project = checkouts[0];
            const on = project?.branch === null || project === undefined ? 'a detached HEAD' : project.branch;
            throw new GitError('target-not-checked-out', `${into} is not checked out anywhere; ${project?.path ?? main} is on ${on}.`);
        }
        settings = settingsFor(into);
        const busy = (await this.worktrees.operationIn(target.path)) ?? ((await gitPathExists(target.path, 'SQUASH_MSG')) ? 'squash' : null);
        if (busy !== null) {
            throw new GitError('target-busy', `A ${busy} waits halfway in ${target.path}. Finish or abort it there first.`);
        }
        /* Untracked files do not count: git refuses a merge that would overwrite one. Neither does
           `.ruimte`, tracked or not: a person moving a node dirties it all day, and what it holds is
           never what a merge is about. */
        if (
            limits.cleanTarget === true &&
            (await git(['status', '--porcelain', '--untracked-files=no', '--', '.', `:(exclude)${PROJECT_DIR}`], target.path))?.trim() !== ''
        ) {
            throw new GitError('target-dirty', `${target.path} has uncommitted changes of its own; a person merges into a checkout like that, not an agent.`);
        }

        const agents = this.agents.in(entry.path, record?.nodeId);
        const working = agents.filter((agent) => agent.working);
        const stopping = payload.stopAgent === true ? agents.filter((agent) => agent.live) : [];
        if (working.length > 0 && payload.stopAgent !== true) {
            throw new GitError(
                'agent-working',
                `${plural(working.length, 'agent is', 'agents are')} still working in ${branch}. Stop ${working.length === 1 ? 'it' : 'them'} first.`
            );
        }
        for (const agent of stopping) {
            sink('start', `Stopping ${agent.nodeId}`);
            await this.agents.stop(agent.nodeId);
        }

        // Counted again after the stop: an agent writes until its CLI is gone.
        const fresh = stopping.length > 0 ? (await this.worktrees.describe(main, entry.path)).work : state.work;
        if (fresh.changed + fresh.untracked > 0) {
            if (payload.commitFirst !== true) {
                throw new GitError(
                    'worktree-has-work',
                    `${branch} holds ${plural(fresh.changed, 'uncommitted file', 'uncommitted files')} and ${plural(fresh.untracked, 'new file', 'new files')}. Commit them first, or the merge would leave half of the work behind.`
                );
            }
            const subject = payload.subject?.trim() || `Work in ${branch}`;
            await must('stage', ['add', '--all'], entry.path);
            await must('commit', ['commit', '--message', subject, ...messageBody(payload.body)], entry.path);
        }

        const ahead = Number.parseInt((await git(['rev-list', '--count', `refs/heads/${into}..refs/heads/${branch}`], main))?.trim() ?? '0', 10) || 0;
        const base: WorktreeMergeResult = { actionId: payload.actionId, summary: '', output: '', cwd: target.path, into };
        let summary: string;
        let squashed = false;
        if (ahead === 0) {
            summary = `${into} already has everything in ${branch}.`;
        } else if (payload.strategy === 'rebase') {
            const rebased = await step('rebase', ['rebase', `refs/heads/${into}`], entry.path);
            if (rebased.code !== 0) {
                const conflicts = await conflictedFiles(entry.path);
                await runGit(['rebase', '--abort'], entry.path);
                throw new GitError(
                    'merge-conflict',
                    conflicts.length > 0
                        ? `Rebasing ${branch} onto ${into} conflicts in ${plural(conflicts.length, 'file', 'files')}: ${conflicts.join(', ')}. ${branch} is as it was; try a merge, or resolve it in the worktree.`
                        : rebased.text || `Rebasing ${branch} onto ${into} failed.`
                );
            }
            await must('merge', ['merge', '--ff-only', `refs/heads/${branch}`], target.path);
            summary = `Rebased ${branch} onto ${into} and fast-forwarded.`;
        } else {
            const squash = payload.strategy === 'squash';
            const head = (await git(['rev-parse', 'HEAD'], target.path))?.trim();
            const merged = await step('merge', squash ? ['merge', '--squash', `refs/heads/${branch}`] : ['merge', '--no-edit', '--no-ff', branch], target.path);
            if (merged.code !== 0) {
                // The exit code does not say whether git refused or ran into a conflict; what it left behind does.
                const conflicts = await conflictedFiles(target.path);
                const waiting = (await gitPathExists(target.path, 'MERGE_HEAD')) || (await gitPathExists(target.path, 'SQUASH_MSG'));
                const moved = (await git(['rev-parse', 'HEAD'], target.path))?.trim() !== head;
                if (conflicts.length === 0 && !waiting && !moved) {
                    // Refused before touching anything, such as over a changed file of the person's the merge would overwrite.
                    throw new GitError('git-failed', merged.text || `Merging ${branch} into ${into} failed.`);
                }
                if (limits.abortOnConflict === true) {
                    await this.abort(target.path).catch(() => undefined);
                    throw new GitError(
                        'merge-conflict',
                        conflicts.length > 0
                            ? `Merging ${branch} into ${into} conflicts in ${plural(conflicts.length, 'file', 'files')}: ${conflicts.join(', ')}. The merge was taken back and ${target.path} is as it was.`
                            : `${merged.text || `Merging ${branch} into ${into} failed.`} The merge was taken back.`
                    );
                }
                // A conflict, or a hook that stopped the merge after it ran: either way it waits in the target for a person.
                const result: WorktreeMergeResult = {
                    ...base,
                    summary:
                        conflicts.length > 0
                            ? `${plural(conflicts.length, 'file conflicts', 'files conflict')} in ${target.path}.`
                            : `The merge waits in ${target.path}: ${merged.text.split('\n')[0] ?? 'git stopped it'}`,
                    output: output.join('\n').trim(),
                    conflicts
                };
                sink('failed', result.summary);
                this.worktrees.announce(main);
                return result;
            }
            if (squash) {
                // A branch whose content the target has already squashes into nothing, and a commit of nothing fails.
                const staged = (await runGit(['diff', '--cached', '--quiet'], target.path)).code !== 0;
                if (staged) {
                    const subject = payload.subject?.trim() || `Merge ${branch}`;
                    await must('commit', ['commit', '--message', subject, ...messageBody(payload.body)], target.path);
                }
                squashed = true;
                summary = staged ? `Squashed ${branch} into ${into}.` : `${into} already has everything in ${branch}.`;
            } else {
                summary = `Merged ${branch} into ${into}.`;
            }
        }

        let removal: Pick<WorktreeMergeResult, 'removed' | 'branchDeleted' | 'kept'> = {};
        if (payload.remove === true) {
            const still = this.agents.in(entry.path, record?.nodeId).filter((agent) => agent.live);
            if (still.length > 0) {
                removal = { removed: false, kept: `${plural(still.length, 'agent still runs', 'agents still run')} in it.` };
            } else {
                try {
                    const removed = await this.worktrees.removeHeld(main, entry.path, squashed || ahead === 0 ? { squashedInto: into } : {});
                    removal = { removed: true, branchDeleted: removed.branchDeleted };
                } catch (e) {
                    removal = { removed: false, kept: errorText(e) };
                }
            }
        }
        this.worktrees.announce(main);
        sink('done', summary);
        return { ...base, summary, output: output.join('\n').trim(), ...removal };
    }

    /* The repository's base as a local branch, since only a local branch can be checked out to merge into. */
    private async localBase(main: string): Promise<string | null> {
        const base = await resolveBase(main);
        if (base === null) {
            return null;
        }
        const local = base.startsWith('origin/') ? base.slice('origin/'.length) : base;
        return (await runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${local}`], main)).code === 0 ? local : null;
    }
}

const messageBody = (body: string | undefined): string[] => (body === undefined || body.trim() === '' ? [] : ['--message', body.trim()]);
