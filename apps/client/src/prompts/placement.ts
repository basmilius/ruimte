/*
 * Whether a chat or terminal node on a canvas draws its own prompt. Off, the canvas's prompt stack is
 * the one place a prompt is answered and the node only points there. A chat or terminal opened as a
 * view of its own has no stack and always keeps its prompt. The in-node code stays, so turning this
 * back on restores it.
 */
export const PROMPTS_IN_NODES = false;
