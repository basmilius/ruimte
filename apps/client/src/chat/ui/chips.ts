/* An `@file` or `$skill` token drawn as a pill: the tone says which of the two it is, the shape
   says where it is drawn. */

export const MENTION_TONE = 'bg-accent-soft text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_25%,transparent)]';

/* A skill is the same token shape as a file mention, in its own hue. */
export const SKILL_TONE = 'bg-skill-soft text-skill shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--skill)_25%,transparent)]';

/*
 * In the composer the pill is painted on a layer behind the textarea, so its horizontal padding is
 * handed straight back as a negative margin: the advance width stays the text's own and every chip
 * keeps sitting on its own characters. Vertical padding on an inline box never changes the line
 * height, so that side needs no compensation, and the ring is inset for the same reason.
 */
export const CHIP_BEHIND_TEXT = 'mx-[-3px] box-decoration-clone rounded-[5px] px-[3px] py-0.5 font-medium';

/* The same pill in the transcript, where nothing has to line up with a textarea: a real inline box
   a shade smaller than the text around it, with the icon in place of the sigil. */
export const CHIP_IN_MESSAGE = 'inline-flex h-[17px] max-w-full items-center gap-1 rounded-md px-1.5 align-[-2px] text-[12px]/none font-medium';
