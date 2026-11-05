import type { AgentKind } from '@ruimte/contracts';
import { createNodeAction, createViewAction } from '@/action-port/person-actions';
import { hasActiveCanvas, useDocument } from '@/state/document';

interface WorktreeChat {
    cwd: string;
    provider: AgentKind;
    title?: string;
    /* The GitHub issue it starts on; only a node on a canvas wears it as a pill. */
    issue?: { repo: string; number: number; url: string };
}

/*
 * A chat in a worktree: a node on the canvas on screen, and in any other view a chat view of its own,
 * since a worktree chat is asked for from wherever the project's folder is. Resolves the chat's id.
 */
export async function createWorktreeChat({ cwd, provider, title, issue }: WorktreeChat): Promise<string | null> {
    const state = useDocument.getState();
    if (hasActiveCanvas(state)) {
        return createNodeAction('chat', { cwd, provider, ...(title === undefined ? {} : { title }), ...(issue === undefined ? {} : { issue }) });
    }
    // A standalone view keeps its session under its own id.
    return createViewAction('chat', { cwd, provider, ...(title === undefined ? {} : { name: title }) });
}
