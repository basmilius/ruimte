/*
 * The utility strings more than a couple of call sites share. They live here and not in
 * `theme.css` because each one is only a bundle of utilities. The stylesheet keeps the tokens and
 * the rules utilities cannot write, and a shared string keeps a call site's own utility winning.
 * A label takes the line height of the row it sits in, which is why the sizes carry `/[inherit]`.
 */

/* The glass card the dock, the banner and a toast are drawn on. */
export const FLOAT = 'border border-border bg-[color-mix(in_srgb,var(--surface-raised)_88%,transparent)] shadow-float backdrop-blur-[14px]';

/* Icon buttons that belong together sit 1px apart; groups keep the wider gap of their container. */
export const BTN_GROUP = 'inline-flex items-center gap-px';

/* The label above a group of menu rows. */
export const MENU_LABEL = 'px-2.5 pt-1.5 pb-0.5 text-xs/[inherit] text-text-faint';

/* The same label outside a popup: the sidebar's groups, the palette's sections. */
export const SECTION_LABEL = 'text-xs/[inherit] font-medium text-text-faint';

/* The bar across the top of a side panel, as tall as the toolbar beside it: the panel's name in
   `SECTION_LABEL`, its own controls, and a close button last. */
export const PANEL_HEADER = 'flex h-12 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3';

/* A row of a list that reads as a table and fills the width of its panel: commits, processes,
   worktrees. Square, so the rows stack into one block; padded 12px beside text and 4px beside a button. */
export const FLAT_ROW = 'flex h-7 items-center';

/* A row of a list a person finds their way through: the sidebar, devices, recent files. Inset from
   the edge and rounded, so each row reads as a place of its own. */
export const INSET_ROW = 'flex h-8 items-center rounded-md px-2';

/* A question or a form of a few fields. Every one is as wide as the others, whatever it asks. */
export const SMALL_DIALOG = 'dialog-popup w-[420px] p-5';

/* The sentence under a dialog's title. */
export const DIALOG_DESCRIPTION = 'text-sm text-text-muted';

/* The line under a field that says what goes in it. */
export const FIELD_HINT = 'mt-1 text-xs text-text-muted';

/* What went wrong in a dialog or a form. It goes with `role="alert"`, so a screen reader hears it arrive. */
export const FORM_ERROR = 'text-xs text-status-error';

/* The buttons at the foot of a dialog, the main action last and so on the right. */
export const DIALOG_FOOTER = 'mt-4 flex flex-wrap items-center justify-end gap-2';

/* A trailing hint in a menu row: what the item does to something else, never a shortcut. Shortcuts stay
   `<kbd>`, which `.menu-item` already pushes to the right. */
export const MENU_HINT = 'ml-auto pl-3 text-xs/[inherit] text-text-faint';

/* The hairline between two groups of menu rows. It runs the whole width of the popup, which is what
   the negative margin buys back from its 4px of padding, and it is softer than a border a surface
   ends with. It divides rows that are already on one surface. */
export const MENU_SEPARATOR = '-mx-1 my-1 h-px bg-border-soft';

/* A shortcut next to a label: in a tooltip, in the palette and on the buttons of a pending question. */
export const TOOLTIP_KBD = 'rounded-sm bg-surface-sunken px-[5px] py-px font-sans text-xs/[inherit] text-text-muted';

/* One accent, drawn as the color itself: in the Appearance row, in its overflow and in the Color
   submenu of a node. The name of the color is a tooltip, so the circle carries the tick alone. */
export const ACCENT_SWATCH = 'grid h-6 w-6 place-items-center rounded-full text-accent-text';

/* The same swatch, picked, inside a popup rather than on the surface behind it. */
export const ACCENT_SWATCH_PICKED = 'ring-2 ring-accent ring-offset-1 ring-offset-surface-raised';

/* A field of a few lines in a panel: the commit message, the body of a pull request, a note on a plan step. */
export const MULTILINE_FIELD = 'field h-auto min-h-16 resize-none px-2 py-1.5 text-xs';
