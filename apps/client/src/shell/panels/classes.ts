/* The utility strings the panels share. Bundles of utilities live next to the components that use
   them; `styles.css` keeps the tokens and the rules utilities cannot write. */

/* The row under a panel's header, for what acts on the panel's body: the preview's view switches,
   the git panel's tree buttons, the files panel's filter. */
export const FILE_TOOLBAR = 'flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface px-2';

/* The header over a group of the git panel: the changes of one state, and the commits of one day. */
export const GIT_GROUP = 'flex h-7 items-center gap-2 pr-2 pl-3 text-xs';

/* A group of the git panel's changes, or a repository in one: a row of the list that the trees under
   it go on from, under the same keys. */
export const GIT_LIST_ROW =
    'mx-0.5 flex shrink-0 cursor-default items-center gap-1.5 rounded-md pr-2 text-xs outline-none hover:bg-surface-hover focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent';
