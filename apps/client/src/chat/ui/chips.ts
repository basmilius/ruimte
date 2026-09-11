/* An `@file` or `$skill` token drawn as a pill: the tone says which of the two it is, the shape
   says where it is drawn. */

export const MENTION_TONE = 'bg-accent-soft text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_25%,transparent)]';

/* A skill is the same token shape as a file mention, in its own hue. */
export const SKILL_TONE = 'bg-skill-soft text-skill shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--skill)_25%,transparent)]';

/*
 * In the composer the pill is painted on a layer behind the textarea, which draws the same string
 * in the same font: the chip may only paint. Anything that moves a glyph (weight, size, letter
 * spacing, horizontal padding, border, margin) walks the drawn text away from the textarea's own
 * characters, and since the caret is placed by the textarea it ends up next to the wrong letter.
 * Horizontal padding cannot be handed back as a negative margin either, because a chip that wraps
 * gets that padding again on every fragment. Vertical padding and an inset ring change no advance
 * width, so the pill takes its height and its outline from those. The full token with its icon
 * lives in the sent message, where nothing has to line up.
 */
export const CHIP_BEHIND_TEXT = 'box-decoration-clone rounded-[4px] py-0.5';

/* The same pill in the transcript, where nothing has to line up with a textarea: a real inline box
   a shade smaller than the text around it, with the icon in place of the sigil. */
export const CHIP_IN_MESSAGE = 'inline-flex h-5 max-w-full items-center gap-1 rounded-md px-1.5 align-[-3px] text-xs/none font-medium';
