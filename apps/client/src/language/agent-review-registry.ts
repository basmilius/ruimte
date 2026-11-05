import type { Editor } from '@adecore/editor';

/* What the commands that step through the agent's changes need of the review `editor-ai` keeps for a file. */
export interface SteppableReview {
    step(direction: 1 | -1): void;
}

const reviews = new WeakMap<Editor, SteppableReview>();

/* The review of the file in an editor, for the commands that step through it. */
export function agentReviewOf(editor: Editor): SteppableReview | null {
    return reviews.get(editor) ?? null;
}

export function registerAgentReview(editor: Editor, review: SteppableReview | null): void {
    if (review === null) {
        reviews.delete(editor);
    } else {
        reviews.set(editor, review);
    }
}
