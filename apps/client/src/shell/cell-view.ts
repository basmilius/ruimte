import type { ProjectView } from '@ruimte/contracts';
import type { Tab } from '@/state/files';

/*
 * A view that stands in a cell without a row in the sidebar or an entry in `project.json`: a file, a
 * diff, a commit or a database view that was opened rather than made. Its id is the key of its tab,
 * and what it shows lives in `state/files.ts`, since it is this client's and this machine's.
 */
export interface LooseCellView {
    kind: 'loose';
    id: string;
    tab: Tab;
    /* The tab's title, translated where the view is built since the interface changes language without a reload. */
    name: string;
}

/* What stands in a cell: a view of the project, or a loose view of this client. */
export type CellView = ProjectView | LooseCellView;

export function isLooseView(view: CellView | null | undefined): view is LooseCellView {
    return view?.kind === 'loose';
}
