import type { GitActionPayload, GitActionPhase, GitActionResult } from '@ruimte/contracts';
import { git, runGit, streamCommand, toplevel, GitError } from './run.ts';

// A push over a slow link is allowed to take this long before the daemon gives up on it.
const NETWORK_TIMEOUT_MS = 120_000;

export type ProgressSink = (phase: GitActionPhase, line: string) => void;

/*
 * One action while it runs: the git that is going right now, so a cancel can end it, and whether a
 * cancel already came in, so the step after this one never starts.
 */
class Job {
    canceled = false;
    private kill: (() => void) | null = null;

    hold(kill: () => void): void {
        this.kill = kill;
        if (this.canceled) {
            kill();
        }
    }

    cancel(): void {
        this.canceled = true;
        this.kill?.();
    }
}

interface StepOptions {
    /* The executable to run; only the pull request step is not git itself. */
    command?: string;
    /* Milliseconds a step that talks to a remote may take before the daemon ends it. */
    timeout?: number;
}

type Step = (phase: GitActionPhase, args: string[], options?: StepOptions) => Promise<string>;

/* What git wrote, with the empty lines gone: the message of a failure and the body of a copy. */
const textOf = (stdout: string, stderr: string): string => `${stdout}${stderr}`.trim();

const summaryOf = (output: string, fallback: string): string => {
    const lines = output.split('\n').filter((line) => line.trim() !== '');
    return lines[lines.length - 1]?.trim() || fallback;
};

/*
 * Every action the git panel takes, run as a list of git calls whose output is streamed while they
 * run. Nothing here ever reaches a shell: the arguments are lists, and a branch name or a commit
 * message is one argument however it is spelled.
 */
export class GitActions {
    private readonly running = new Map<string, Job>();

    /* Ends the git of an action that is still going; a cancel for one that is over does nothing. */
    cancel(actionId: string): void {
        this.running.get(actionId)?.cancel();
    }

    /*
     * A slot for a process that is not an action of ours but is stopped the same way: the CLI that
     * writes a commit message answers to the same `git.cancel`.
     */
    claim(actionId: string): { hold(kill: () => void): void; release(): void } {
        const job = new Job();
        this.running.set(actionId, job);
        return {
            hold: (kill) => job.hold(kill),
            release: () => {
                if (this.running.get(actionId) === job) {
                    this.running.delete(actionId);
                }
            }
        };
    }

    async run(payload: GitActionPayload, sink: ProgressSink): Promise<GitActionResult> {
        const job = new Job();
        this.running.set(payload.actionId, job);
        try {
            return await this.perform(payload, sink, job);
        } finally {
            this.running.delete(payload.actionId);
        }
    }

    private async perform(payload: GitActionPayload, sink: ProgressSink, job: Job): Promise<GitActionResult> {
        const top = await toplevel(payload.cwd);
        const output: string[] = [];

        /* One call: its lines go out as progress and are kept for the result at the same time. */
        const step: Step = async (phase, args, options = {}) => {
            if (job.canceled) {
                throw new GitError('git-failed', 'The action was canceled.');
            }
            sink(phase, '');
            const timeout = options.timeout ?? 0;
            const timer = timeout > 0 ? setTimeout(() => job.cancel(), timeout) : null;
            try {
                const result = await streamCommand(options.command ?? 'git', args, top, {
                    onLine: (line) => sink(phase, line),
                    onSpawn: (kill) => job.hold(kill)
                });
                const text = textOf(result.stdout, result.stderr);
                output.push(text);
                if (result.code !== 0) {
                    sink('failed', text);
                    throw new GitError('git-failed', job.canceled ? 'The action was canceled.' : text || `${options.command ?? 'git'} ${args[0]} failed`);
                }
                return text;
            } finally {
                if (timer !== null) {
                    clearTimeout(timer);
                }
            }
        };

        const done = (summary: string, extra: Partial<GitActionResult> = {}): GitActionResult => {
            sink('done', summary);
            return { actionId: payload.actionId, summary, output: output.join('\n').trim(), ...extra };
        };

        const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], top))?.trim() ?? '';
        const upstream = (await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], top))?.trim() || null;

        switch (payload.kind) {
            case 'fetch': {
                const text = await step('fetch', ['fetch', '--prune', '--progress'], { timeout: NETWORK_TIMEOUT_MS });
                return done(text === '' ? 'Nothing new to fetch.' : 'Fetched from the remote.');
            }
            case 'pull': {
                const text = await step('pull', ['pull', '--ff-only', '--progress'], { timeout: NETWORK_TIMEOUT_MS });
                return done(text.includes('Already up to date') ? 'Already up to date.' : `Pulled into ${branch}.`);
            }
            case 'push':
            case 'publish':
            case 'force-push': {
                return done(await this.push(payload, step, branch, upstream));
            }
            case 'sync': {
                if (upstream !== null) {
                    await step('pull', ['pull', '--ff-only', '--progress'], { timeout: NETWORK_TIMEOUT_MS });
                }
                await this.push(payload, step, branch, upstream);
                return done(`Synced ${branch}.`);
            }
            case 'checkout': {
                const ref = required(payload.ref, 'a branch to check out');
                if (payload.stash === true) {
                    await step('stash', ['stash', 'push', '--include-untracked', '--message', `ruimte-switch-${stamp()}`]);
                }
                await step('branch', await checkoutArgs(top, ref));
                return done(`Now on ${ref}.`);
            }
            case 'create-branch': {
                const name = required(payload.name, 'a name for the branch');
                await step('branch', ['checkout', '-b', name, ...(payload.ref ? [payload.ref] : [])]);
                return done(`Created ${name}.`);
            }
            case 'rename-branch': {
                const name = required(payload.name, 'a name for the branch');
                await step('branch', ['branch', '--move', name]);
                return done(`${branch} is now ${name}.`);
            }
            case 'delete-branch': {
                const ref = required(payload.ref, 'a branch to delete');
                await step('branch', ['branch', '--delete', ...(payload.force === true ? ['--force'] : []), ref]);
                return done(`Deleted ${ref}.`);
            }
            case 'merge': {
                const ref = required(payload.ref, 'a branch to merge');
                const text = await step('merge', ['merge', '--no-edit', ref]);
                return done(summaryOf(text, `Merged ${ref} into ${branch}.`));
            }
            case 'rebase': {
                const ref = required(payload.ref, 'a branch to rebase onto');
                const text = await step('rebase', ['rebase', ref]);
                return done(summaryOf(text, `Rebased ${branch} onto ${ref}.`));
            }
            case 'stash': {
                const args = ['stash', 'push', '--include-untracked'];
                if (payload.subject !== undefined && payload.subject.trim() !== '') {
                    args.push('--message', payload.subject.trim());
                }
                const text = await step('stash', args);
                return done(text.includes('No local changes') ? 'There was nothing to stash.' : 'Changes are in a stash.');
            }
            case 'stash-pop': {
                await step('stash', ['stash', 'pop', ...(payload.ref ? [payload.ref] : [])]);
                return done(`Took ${payload.ref ?? 'the newest stash'} back.`);
            }
            case 'commit': {
                const commit = await this.commit(payload, step, top);
                return done(`Committed ${commit.subject}.`, { commit });
            }
            case 'commit-push': {
                const commit = await this.commit(payload, step, top);
                const pushed = await this.push(payload, step, branch, upstream);
                return done(`Committed ${commit.subject}. ${pushed}`, { commit });
            }
            case 'create-pr': {
                if (upstream === null) {
                    await this.push({ ...payload, kind: 'publish' }, step, branch, upstream);
                }
                const title = required(payload.subject, 'a title for the pull request');
                const text = await step('pr', ['pr', 'create', '--title', title, '--body', payload.body ?? ''], {
                    command: 'gh',
                    timeout: NETWORK_TIMEOUT_MS
                });
                const url = /https:\/\/\S+/.exec(text)?.[0] ?? null;
                return done(url === null ? 'The pull request is open.' : `Pull request ready: ${url}`, url === null ? {} : { url });
            }
        }
    }

    /* The one push there is: with an upstream, without one, or over what the remote holds. */
    private async push(payload: GitActionPayload, step: Step, branch: string, upstream: string | null): Promise<string> {
        const args = ['push', '--progress'];
        if (payload.kind === 'force-push') {
            args.push('--force-with-lease');
        }
        if (upstream === null) {
            args.push('--set-upstream', 'origin', branch);
        }
        const text = await step('push', args, { timeout: NETWORK_TIMEOUT_MS });
        if (text.includes('Everything up-to-date')) {
            return 'Everything was already pushed.';
        }
        return upstream === null ? `Published ${branch} to origin.` : `Pushed ${branch}.`;
    }

    /* Stage what was asked for, then write the commit and read back what git made of it. */
    private async commit(payload: GitActionPayload, step: Step, top: string): Promise<{ hash: string; subject: string }> {
        if (payload.stageAll === true) {
            await step('stage', ['add', '--all']);
        }
        const subject = required(payload.subject?.trim(), 'a commit message');
        const body = payload.body?.trim() ?? '';
        await step('commit', ['commit', '--message', subject, ...(body === '' ? [] : ['--message', body])]);
        const hash = (await git(['rev-parse', 'HEAD'], top))?.trim() ?? '';
        return { hash, subject };
    }
}

/* A field the kind cannot do without; a client that leaves it out is asking for a failure, not a git. */
const required = (value: string | undefined, what: string): string => {
    if (value === undefined || value === '') {
        throw new GitError('git-failed', `This action needs ${what}.`);
    }
    return value;
};

const stamp = (): string => new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');

/*
 * Checking out a remote branch means making the local one that follows it, unless a local branch of
 * that name is already there, in which case that is the branch the person means.
 */
export const checkoutArgs = async (top: string, ref: string): Promise<string[]> => {
    const local = (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${ref}`], top))?.trim();
    if (local) {
        return ['checkout', ref];
    }
    const short = ref.slice(ref.indexOf('/') + 1);
    const tracked = (await git(['rev-parse', '--verify', '--quiet', `refs/remotes/${ref}`], top))?.trim();
    if (tracked) {
        const existing = (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${short}`], top))?.trim();
        return existing ? ['checkout', short] : ['checkout', '--track', ref];
    }
    return ['checkout', ref];
};

/* Whether the working tree holds anything a checkout would have to carry over or lose. */
export const isDirty = async (cwd: string): Promise<boolean> => {
    const { code, stdout } = await runGit(['status', '--porcelain'], cwd);
    return code === 0 && stdout.trim() !== '';
};
