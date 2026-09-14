/* An `@file` or `$skill` token drawn as a pill: the tone says which of the two it is, the shape
   says where it is drawn. */

export const MENTION_TONE = 'bg-accent-soft text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_25%,transparent)]';

/* A skill is the same token shape as a file mention, in its own hue. */
export const SKILL_TONE = 'bg-skill-soft text-skill shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--skill)_25%,transparent)]';

/* The pill in the composer's editor, around the token's own characters: the editor places the caret
   from what it drew, so padding is safe, and a chip that wraps keeps it on every fragment. */
export const CHIP_IN_EDITOR = 'box-decoration-clone rounded-md px-1 py-0.5';

/* The same pill in the transcript: a real inline box a shade smaller than the text around it, with
   the icon in place of the sigil. */
export const CHIP_IN_MESSAGE = 'inline-flex h-5 max-w-full items-center gap-1 rounded-md px-1.5 align-[-3px] text-xs/none font-medium';
