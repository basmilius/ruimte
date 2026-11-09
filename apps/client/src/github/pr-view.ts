import type { GitPrCheck, GitPrThread, GitPullRequest } from '@ruimte/contracts';
import { selectionBlock } from '@/language/selection-to-chat';

interface ThreadFilter {
    showBots: boolean;
    showResolved: boolean;
}

interface VisibleThreads {
    shown: GitPrThread[];
    hiddenBots: number;
    hiddenResolved: number;
}

/* A thread belongs to a bot when the one who opened it is one. */
function isBotThread(thread: GitPrThread): boolean {
    return thread.comments[0]?.bot === true;
}

/* The threads a person asked to see, and how many each switch holds back; a thread both resolved and from a bot counts as resolved. */
export function visibleThreads(threads: readonly GitPrThread[], filter: ThreadFilter): VisibleThreads {
    const shown: GitPrThread[] = [];
    let hiddenBots = 0;
    let hiddenResolved = 0;
    for (const thread of threads) {
        if (thread.resolved && !filter.showResolved) {
            hiddenResolved += 1;
        } else if (isBotThread(thread) && !filter.showBots) {
            hiddenBots += 1;
        } else {
            shown.push(thread);
        }
    }
    return { shown, hiddenBots, hiddenResolved };
}

interface CheckGroups {
    failed: GitPrCheck[];
    pending: GitPrCheck[];
    passed: GitPrCheck[];
}

export function groupChecks(checks: readonly GitPrCheck[]): CheckGroups {
    return {
        failed: checks.filter((check) => check.state === 'failure'),
        pending: checks.filter((check) => check.state === 'pending'),
        passed: checks.filter((check) => check.state === 'success' || check.state === 'neutral' || check.state === 'skipped')
    };
}

const MERGE_STATES = ['clean', 'blocked', 'behind', 'dirty', 'draft', 'has_hooks', 'unstable'];

/* The key of the sentence for GitHub's merge state; a state this does not know reads as unknown. */
export function mergeStateKey(pr: Pick<GitPullRequest, 'mergeable' | 'mergeState'>): string {
    if (pr.mergeable === 'CONFLICTING') {
        return 'dirty';
    }
    const state = pr.mergeState.toLowerCase();
    return MERGE_STATES.includes(state) ? state : 'unknown';
}

/* A thread as text for a chat's prompt, with where it hangs and who said what. */
export function threadBlock(pr: Pick<GitPullRequest, 'repo' | 'number'>, thread: GitPrThread): string {
    const where = thread.path === undefined ? '' : thread.line === undefined ? thread.path : `${thread.path}:${thread.line}`;
    const heading = `Review thread on ${pr.repo}#${pr.number}${where === '' ? '' : ` at ${where}`}${thread.resolved ? ' (resolved)' : ''}`;
    const text = thread.comments.map((comment) => `${comment.author}${comment.bot ? ' (bot)' : ''}: ${comment.body.trim()}`).join('\n\n');
    return selectionBlock(heading, text, null);
}
