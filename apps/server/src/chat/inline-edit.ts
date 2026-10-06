import type { PromptNotes } from '@adecore/agents/chat/chat-session';

/*
 * What an inline edit's chat hears once, in front of its first prompt and never in the thread: the
 * person's own message carries the selection, so a thread read as a chat shows only what they asked.
 * The block label is how the client finds the proposal (`apps/client/src/editor-ai/inline-edit-model.ts`).
 */
export const INLINE_EDIT_PREAMBLE = [
    "This chat edits a part of one file for a person in Ruimte's code editor. Each message names the file and the selected lines.",
    'Do not edit, create or delete any file, and do not run commands that change anything.',
    'Answer with exactly one fenced code block whose info string is "replacement", holding the complete new text for the selected lines: the same indentation, no line numbers and no file path.',
    'Use a fence longer than any run of backticks inside the code.',
    'After the block write at most two sentences about what you changed.',
    'When the request needs no change, answer in two sentences and leave the block out.',
    'A later message is a follow-up on the same selection, so answer it with a new replacement block that holds the whole text again.'
].join('\n');

/* The notes of a chat, with the preamble in front of the first prompt and again after the chat started over. */
export class InlineEditNotes implements PromptNotes {
    private readonly inner: PromptNotes;
    private said = false;

    constructor(inner: PromptNotes) {
        this.inner = inner;
    }

    next(): { shown: string[]; heard: string[] } {
        const notes = this.inner.next();
        if (this.said) {
            return notes;
        }
        this.said = true;
        return { shown: notes.shown, heard: [INLINE_EDIT_PREAMBLE, ...notes.heard] };
    }

    reset(): void {
        this.said = false;
        this.inner.reset();
    }
}
