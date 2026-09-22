import type { ProjectView } from '@ruimte/contracts';

/*
 * The cell that holds the open files. It is the one view the project document does not have: which
 * files a person has open is theirs and this machine's, the way the tabs themselves always were
 * (`state/files.ts`). The id is reserved rather than generated, so the layout of a client that
 * never opened a file reads the same, and a hand-written `project.json` can never name a view this
 * window would draw as the files.
 */
export const FILES_VIEW_ID = 'files';

export interface FilesView {
    kind: 'files';
    id: typeof FILES_VIEW_ID;
    /* Translated where it is built, since the interface changes language without a reload. */
    name: string;
}

/* What stands in a cell: a view of the project, or the files of this client. */
export type CellView = ProjectView | FilesView;

export const isFilesView = (view: CellView | null | undefined): view is FilesView => view?.kind === 'files';

export const filesView = (name: string): FilesView => ({ kind: 'files', id: FILES_VIEW_ID, name });
