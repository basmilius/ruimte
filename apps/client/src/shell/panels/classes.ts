/* The utility strings the panels share. Bundles of utilities live next to the components that use
   them; `styles.css` keeps the tokens and the rules utilities cannot write. */

/* The row under a panel's header, for what acts on the panel's body: the preview's view switches,
   the git panel's tree buttons, the files panel's filter. */
export const FILE_TOOLBAR = 'flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface px-2';

/* The header over a group of the git panel: the changes of one state, and the commits of one day. */
export const GIT_GROUP = 'flex h-7 items-center gap-2 pr-2 pl-3 text-xs';

/* The message of the commit to come. The one multiline field in the app, so it carries the field's
   border and focus ring without its fixed height. */
export const COMMIT_MESSAGE =
    'min-h-16 w-full resize-none rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text outline-none placeholder:text-text-faint focus-visible:-outline-offset-1 focus-visible:outline-2 focus-visible:outline-accent';
