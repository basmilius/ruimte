import type { Editor } from '@adecore/editor';
import type { AgentReview } from './agent-review';

const reviews = new WeakMap<Editor, AgentReview>();

/* The review of the file in an editor, for the commands that step through it. */
export function agentReviewOf(editor: Editor): AgentReview | null {
    return reviews.get(editor) ?? null;
}

export function registerAgentReview(editor: Editor, review: AgentReview | null): void {
    if (review === null) {
        reviews.delete(editor);
    } else {
        reviews.set(editor, review);
    }
}
