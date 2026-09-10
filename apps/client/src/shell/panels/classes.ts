/* The utility strings the panels share. Bundles of utilities live next to the components that use
   them; `styles.css` keeps the tokens and the rules utilities cannot write. */

/* The viewer's own row under the panel's header, for whatever the open file can be switched between. */
export const FILE_TOOLBAR = 'flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface px-2';

/* The git panel's list: a header per group, then a row per changed file. */
export const GIT_GROUP = 'flex h-7 items-center gap-2 pr-2 pl-3 text-xs';

/* The change the preview has open reads as the selected row, the way a tree marks one. */
export const GIT_ROW =
    'group flex h-7 items-center pr-1 text-text-muted hover:bg-surface-sunken hover:text-text data-[selected]:bg-surface-active data-[selected]:text-text';

/* What opens a row, on the row's own color. */
export const GIT_ROW_OPEN = 'flex h-7 min-w-0 flex-1 items-center gap-1.5 pr-1 pl-3 text-xs text-inherit';

/* The buttons are the row's own, so they only show while the pointer is on it or one has focus. */
export const GIT_ROW_ACTIONS = 'invisible group-hover:visible group-focus-within:visible';

/* The message of the commit to come. The one multiline field in the app, so it carries the field's
   border and focus ring without its fixed height. */
export const COMMIT_MESSAGE =
    'min-h-16 w-full resize-none rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text outline-none placeholder:text-text-faint focus-visible:-outline-offset-1 focus-visible:outline-2 focus-visible:outline-accent';
