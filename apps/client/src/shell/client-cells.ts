import type { ProjectView } from '@ruimte/contracts';

/*
 * The cells that hold what this client has open: the files, and the tables and consoles of the
 * databases. The project document does not hold them: what a person has open is theirs and this
 * machine's, the way the tabs themselves always were (`state/files.ts`, `database/state.ts`). The
 * ids are reserved rather than generated, so the layout of a client that never opened one reads the
 * same, and a hand-written `project.json` can never name a view this window would draw as one.
 */
export const FILES_VIEW_ID = 'files';
export const DATABASES_VIEW_ID = 'databases';

export const CLIENT_CELL_IDS = [FILES_VIEW_ID, DATABASES_VIEW_ID] as const;

export type ClientCellId = (typeof CLIENT_CELL_IDS)[number];

export interface ClientCellView<Id extends ClientCellId = ClientCellId> {
    kind: Id;
    id: Id;
    /* Translated where it is built, since the interface changes language without a reload. */
    name: string;
}

export type FilesView = ClientCellView<typeof FILES_VIEW_ID>;
export type DatabasesView = ClientCellView<typeof DATABASES_VIEW_ID>;

/* What stands in a cell: a view of the project, or one of the cells of this client. */
export type CellView = ProjectView | FilesView | DatabasesView;

export function isClientCellId(id: string | null | undefined): id is ClientCellId {
    return (CLIENT_CELL_IDS as readonly (string | null | undefined)[]).includes(id);
}

export function isFilesView(view: CellView | null | undefined): view is FilesView {
    return view?.kind === FILES_VIEW_ID;
}

export function isDatabasesView(view: CellView | null | undefined): view is DatabasesView {
    return view?.kind === DATABASES_VIEW_ID;
}

export function isClientCell(view: CellView | null | undefined): view is FilesView | DatabasesView {
    return isFilesView(view) || isDatabasesView(view);
}

export function clientCellView<Id extends ClientCellId>(id: Id, name: string): ClientCellView<Id> {
    return { kind: id, id, name };
}
