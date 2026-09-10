/*
 * The utility strings more than a couple of call sites share. They live here and not in
 * `styles.css` because each one is only a bundle of utilities: the stylesheet keeps the tokens and
 * the rules utilities cannot write, and a shared string keeps a call site's own utility winning.
 * A label takes the line height of the row it sits in, which is why the sizes carry `/[inherit]`.
 */

/* The glass card the dock, the banner and a toast are drawn on. */
export const FLOAT = 'border border-border bg-[color-mix(in_srgb,var(--surface-raised)_88%,transparent)] shadow-float backdrop-blur-[14px]';

/* Icon buttons that belong together sit 1px apart; groups keep the wider gap of their container. */
export const BTN_GROUP = 'inline-flex items-center gap-px';

/* The uppercase label above a group of menu rows. */
export const MENU_LABEL = 'px-2.5 pt-1.5 pb-0.5 text-xs/[inherit] tracking-[0.04em] text-text-faint uppercase';

/* The same label outside a popup: the sidebar's groups, the palette's sections. */
export const SECTION_LABEL = 'text-xs/[inherit] font-medium tracking-[0.04em] text-text-faint uppercase';

/* A trailing hint in a menu row: what the item does to something else, never a chord. Chords stay
   `<kbd>`, which `.menu-item` already pushes to the right. */
export const MENU_HINT = 'ml-auto pl-3 text-xs/[inherit] text-text-faint';

/* The hairline between two groups of menu rows. */
export const MENU_SEPARATOR = 'mx-1.5 my-1 h-px bg-border';

/* A chord next to a label: in a tooltip, in the palette and on the buttons of a pending question. */
export const TOOLTIP_KBD = 'rounded-sm bg-surface-sunken px-[5px] py-px font-sans text-xs/[inherit] text-text-muted';
