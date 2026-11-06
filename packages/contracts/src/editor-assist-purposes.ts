import { EXPLAIN_INSTRUCTIONS } from './editor-assist-explain.ts';
import { GHOST_INSTRUCTIONS } from './editor-assist-ghost.ts';
import { NAMES_INSTRUCTIONS } from './editor-assist-names.ts';
import type { EditorAssistPurpose } from './editor-assist.ts';

/*
 * What the daemon tells the model for each purpose. The request that follows is written by the client with the
 * `*Prompt` function of the same file, and its reply is read with the parser there, so the three move together.
 * Each feature has one bounded task; the CLI receives no project context.
 */
export const EDITOR_ASSIST_INSTRUCTIONS: Record<EditorAssistPurpose, string> = {
    explain: EXPLAIN_INSTRUCTIONS,
    names: NAMES_INSTRUCTIONS,
    ghost: GHOST_INSTRUCTIONS
};
