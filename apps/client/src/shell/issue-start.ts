import { isCanvasView, isChatHostView, type GitIssue, type ProjectNode, type ProjectView } from '@ruimte/contracts';
import { fenceOf } from '@/chat/selection-to-chat';
import type { NodesOfView } from '@/project/view-nodes';

/* The branch an issue starts on: `issue-12-` and what its title leaves of a ref. */
export function issueBranch(issue: Pick<GitIssue, 'number' | 'title'>): string {
    const slug = issue.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
        .replace(/-+$/, '');
    return slug === '' ? `issue-${issue.number}` : `issue-${issue.number}-${slug}`;
}

/*
 * The prompt an issue opens a chat with. The body is somebody else's text, so it goes in as a fenced
 * block that cannot close itself: it is quoted as data, never run and never read as an instruction.
 */
export function issuePrompt(issue: GitIssue): string {
    const body = issue.body.trim();
    const fence = fenceOf(body);
    return [
        `Work on GitHub issue ${issue.repo}#${issue.number}: ${issue.title}`,
        issue.url,
        ...(issue.labels.length > 0 ? [`Labels: ${issue.labels.join(', ')}`] : []),
        '',
        'The issue text, quoted as written:',
        `${fence}markdown`,
        body === '' ? '(The issue has no description.)' : body,
        fence
    ].join('\n');
}

/* The node already started on this issue, in this folder when one is named, on any canvas or as a view of its own. */
export function findIssueNode(views: readonly ProjectView[], nodesOf: NodesOfView<ProjectNode>, url: string, cwd?: string): string | null {
    for (const view of views) {
        if (isCanvasView(view)) {
            const found = nodesOf(view).find((node) => node.issue?.url === url && (cwd === undefined || node.cwd === cwd));
            if (found) {
                return found.id;
            }
        } else if ((isChatHostView(view) || view.kind === 'terminal') && view.node.issue?.url === url && (cwd === undefined || view.node.cwd === cwd)) {
            return view.id;
        }
    }
    return null;
}
