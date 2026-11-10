import type { GitActionPayload, GitActionPhase, GitActionResult } from '@ruimte/contracts';
import { conflictedFiles } from './conflict.ts';
import {
    LEAVE_NOTHING_OUT,
    READ_ONLY_GIT,
    git,
    leavingOut,
    runGit,
    streamCommand,
    toplevel,
    verifyRev,
    GitError,
    type GitErrorCode,
    type LeftOut
} from './run.ts';
import { stashStamp } from './stage.ts';

// A push over a slow link is allowed to take this long before the daemon gives up on it.
const NETWORK_TIMEOUT_MS = 120_000;

export type ProgressSink = (phase: GitActionPhase, line: string) => void;

/*
 * One action while it runs: the git that is going right now, so a cancel can end it, and whether a
 * cancel already came in, so the step after this one never starts.
 */
export class Job {
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
    timeout?: number;
}

type Step = (phase: GitActionPhase, args: string[], options?: StepOptions) => Promise<string>;

/* A step whose failure is an outcome rather than the end of the action, such as a merge that conflicts. */
type Attempt = (phase: GitActionPhase, args: string[], options?: StepOptions) => Promise<{ code: number; text: string }>;

interface Steps {
    step: Step;
    attempt: Attempt;
    joining(phase: GitActionPhase, args: string[], clean: (text: string) => string, options?: StepOptions): Promise<GitActionResult>;
    done(summary: string, extra?: Partial<GitActionResult>): GitActionResult;
}

/* What git wrote, trimmed: the message of a failure and the body of a copy. */
function textOf(stdout: string, stderr: string): string {
    return `${stdout}${stderr}`.trim();
}

function summaryOf(output: string, fallback: string): string {
    const last = output.split('\n').findLast((line) => line.trim() !== '');
    return last?.trim() || fallback;
}

/*
 * Every action the git panel takes, run as a list of git calls whose output is streamed while they
 * run. Nothing here ever reaches a shell: the arguments are lists, and a branch name or a commit
 * message is one argument however it is spelled.
 */
export class GitActions {
    private readonly running = new Map<string, Job>();
    private readonly leftOut: LeftOut;

    constructor(leftOut: LeftOut = LEAVE_NOTHING_OUT) {
        this.leftOut = leftOut;
    }

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
        const attempt: Attempt = async (phase, args, options = {}) => {
            if (job.canceled) {
                throw new GitError('git-failed', 'The action was canceled.');
            }
            sink(phase, '');
            const timeout = options.timeout ?? 0;
            const timer = timeout > 0 ? setTimeout(() => job.cancel(), timeout) : null;
            try {
                const result = await streamCommand(options.command ?? 'git', args, top, {
                    onLine: (line) => sink(phase, line),
                    onSpawn: (kill) => job.hold(kill),
                    group: true
                });
                const text = textOf(result.stdout, result.stderr);
                output.push(text);
                return { code: result.code, text };
            } finally {
                if (timer !== null) {
                    clearTimeout(timer);
                }
            }
        };

        const fail = (text: string, command: string, args: string[], code: GitErrorCode = 'git-failed'): never => {
            sink('failed', text);
            throw new GitError(code, job.canceled ? 'The action was canceled.' : text || `${command} ${args[0]} failed`);
        };

        const step: Step = async (phase, args, options = {}) => {
            const { code, text } = await attempt(phase, args, options);
            return code === 0 ? text : fail(text, options.command ?? 'git', args);
        };

        const done = (summary: string, extra: Partial<GitActionResult> = {}): GitActionResult => {
            sink('done', summary);
            return { actionId: payload.actionId, summary, output: output.join('\n').trim(), ...extra };
        };

        /*
         * A step that brings two histories together. Git refusing halfway is not a failure here: the
         * files it left unmerged are the outcome, and the checkout keeps the operation until a person
         * finishes it or takes it back.
         */
        const joining = async (phase: GitActionPhase, args: string[], clean: (text: string) => string, options?: StepOptions): Promise<GitActionResult> => {
            const { code, text } = await attempt(phase, args, options);
            if (code === 0) {
                return done(clean(text));
            }
            const conflicts = await conflictedFiles(top);
            if (conflicts.length === 0) {
                return fail(text, 'git', args);
            }
            return done(conflicts.length === 1 ? '1 file conflicts.' : `${conflicts.length} files conflict.`, { conflicts });
        };
        const steps: Steps = { step, attempt, joining, done };

        const [head, tracking] = await Promise.all([
            git(['rev-parse', '--abbrev-ref', 'HEAD'], top),
            git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], top)
        ]);
        const branch = head?.trim() ?? '';
        const upstream = tracking?.trim() || null;

        switch (payload.kind) {
            case 'fetch': {
                const text = await step('fetch', ['fetch', '--prune', '--progress'], { timeout: NETWORK_TIMEOUT_MS });
                return done(text === '' ? 'Nothing new to fetch.' : 'Fetched from the remote.');
            }
            case 'pull': {
                return await this.pull(payload, steps, branch, top);
            }
            case 'push':
            case 'publish':
            case 'force-push': {
                return done(await this.push(payload, step, branch, upstream));
            }
            case 'sync': {
                if (upstream !== null) {
                    const pulled = await this.pull(payload, steps, branch, top);
                    // Nothing is pushed over a checkout that waits on a person.
                    if (pulled.conflicts !== undefined) {
                        return pulled;
                    }
                }
                await this.push(payload, step, branch, upstream);
                return done(`Synced ${branch}.`);
            }
            case 'checkout': {
                const ref = operand(payload.ref, 'a branch to check out');
                if (payload.stash === true) {
                    const args = ['stash', 'push', '--include-untracked', '--message', `ruimte-switch-${stashStamp()}`];
                    await step('stash', [...args, ...leavingOut(await this.leftOut(top))]);
                }
                await step('branch', await checkoutArgs(top, ref));
                return done(`Now on ${ref}.`);
            }
            case 'create-branch': {
                const name = operand(payload.name, 'a name for the branch');
                const start = payload.ref ? [operand(payload.ref, 'a branch to start from')] : [];
                await step('branch', ['checkout', '-b', name, '--end-of-options', ...start]);
                return done(`Created ${name}.`);
            }
            case 'rename-branch': {
                const name = operand(payload.name, 'a name for the branch');
                await step('branch', ['branch', '--move', '--end-of-options', name]);
                return done(`${branch} is now ${name}.`);
            }
            case 'delete-branch': {
                const ref = operand(payload.ref, 'a branch to delete');
                const args = ['branch', '--delete', ...(payload.force === true ? ['--force'] : []), '--end-of-options', ref];
                const deleted = await attempt('branch', args);
                if (deleted.code !== 0) {
                    fail(deleted.text, 'git', args, deleted.text.includes('not fully merged') ? 'branch-not-merged' : 'git-failed');
                }
                return done(`Deleted ${ref}.`);
            }
            case 'merge': {
                const ref = operand(payload.ref, 'a branch to merge');
                return await joining('merge', ['merge', '--no-edit', '--end-of-options', ref], (text) => summaryOf(text, `Merged ${ref} into ${branch}.`));
            }
            case 'rebase': {
                const ref = operand(payload.ref, 'a branch to rebase onto');
                return await joining('rebase', ['rebase', '--end-of-options', ref], (text) => summaryOf(text, `Rebased ${branch} onto ${ref}.`));
            }
            case 'stash': {
                const args = ['stash', 'push', '--include-untracked'];
                if (payload.subject !== undefined && payload.subject.trim() !== '') {
                    args.push('--message', payload.subject.trim());
                }
                const text = await step('stash', [...args, ...leavingOut(await this.leftOut(top))]);
                return done(text.includes('No local changes') ? 'There was nothing to stash.' : 'Changes are in a stash.');
            }
            case 'stash-pop': {
                const stash = payload.ref ? [operand(payload.ref, 'a stash to take back')] : [];
                return await joining('stash', ['stash', 'pop', '--end-of-options', ...stash], () => `Took ${payload.ref ?? 'the newest stash'} back.`);
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

    /*
     * A pull only fast-forwards until a person says how a branch that moved on both sides comes
     * together. Git's refusal is a question rather than a failure, so it comes back as one the panel
     * can ask; with an answer the pull merges or rebases, and the files it leaves unmerged are the
     * outcome of the action.
     */
    private async pull(payload: GitActionPayload, steps: Steps, branch: string, top: string): Promise<GitActionResult> {
        const summary = (text: string): string => (text.includes('Already up to date') ? 'Already up to date.' : `Pulled into ${branch}.`);
        if (payload.strategy === undefined) {
            const { code, text } = await steps.attempt('pull', ['pull', '--ff-only', '--progress'], { timeout: NETWORK_TIMEOUT_MS });
            if (code === 0) {
                return steps.done(summary(text));
            }
            if (await diverged(top)) {
                throw new GitError('diverged', `${branch} and the remote have both moved on.`);
            }
            throw new GitError('git-failed', text || 'git pull failed');
        }
        const args = ['pull', payload.strategy === 'rebase' ? '--rebase' : '--no-rebase', '--no-edit', '--progress'];
        return await steps.joining('pull', args, summary, { timeout: NETWORK_TIMEOUT_MS });
    }

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

    private async commit(payload: GitActionPayload, step: Step, top: string): Promise<{ hash: string; subject: string }> {
        if (payload.stageAll === true) {
            await step('stage', ['add', '--all', ...leavingOut(await this.leftOut(top))]);
        }
        const subject = required(payload.subject?.trim(), 'a commit message');
        const body = payload.body?.trim() ?? '';
        const amend = payload.amend === true;
        if (amend && (await verifyRev('HEAD', top)) === null) {
            throw new GitError('git-failed', 'There is no commit to amend yet.');
        }
        await step('commit', ['commit', ...(amend ? ['--amend'] : []), '--message', subject, ...(body === '' ? [] : ['--message', body])]);
        const hash = (await git(['rev-parse', 'HEAD'], top))?.trim() ?? '';
        return { hash, subject };
    }
}

/* A field the kind cannot do without; a client that leaves it out is asking for a failure, not a git. */
function required(value: string | undefined, what: string): string {
    if (value === undefined || value === '') {
        throw new GitError('git-failed', `This action needs ${what}.`);
    }
    return value;
}

/*
 * A ref or a name from the client, which git would read as an option when it starts with a dash:
 * `--force` on a checkout throws work away and `--exec=` on a rebase runs a command.
 */
function operand(value: string | undefined, what: string): string {
    const text = required(value, what);
    if (text.startsWith('-')) {
        throw new GitError('git-failed', `A branch or ref never starts with a dash: ${text}`);
    }
    return text;
}

/*
 * Checking out a remote branch means making the local one that follows it, unless a local branch of
 * that name is already there, in which case that is the branch the person means.
 */
async function checkoutArgs(top: string, ref: string): Promise<string[]> {
    if ((await verifyRev(`refs/heads/${ref}`, top)) !== null) {
        return ['checkout', '--end-of-options', ref];
    }
    const short = ref.slice(ref.indexOf('/') + 1);
    if ((await verifyRev(`refs/remotes/${ref}`, top)) !== null) {
        return (await verifyRev(`refs/heads/${short}`, top)) !== null
            ? ['checkout', '--end-of-options', short]
            : ['checkout', '--track', '--end-of-options', ref];
    }
    return ['checkout', '--end-of-options', ref];
}

async function diverged(cwd: string): Promise<boolean> {
    const counts = (await git(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], cwd))?.trim().split(/\s+/);
    return Number.parseInt(counts?.[0] ?? '', 10) > 0 && Number.parseInt(counts?.[1] ?? '', 10) > 0;
}

export async function isDirty(cwd: string): Promise<boolean> {
    const { code, stdout } = await runGit(['status', '--porcelain'], cwd, { env: READ_ONLY_GIT });
    return code === 0 && stdout.trim() !== '';
}
