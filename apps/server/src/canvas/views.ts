import {
    PROJECT_ICON_NAMES,
    PROJECT_VIEW_KINDS,
    emptyCanvasView,
    storedPathOf,
    type ProjectContent,
    type ProjectIconChoice,
    type ProjectView,
    type ProjectViewKind
} from '@ruimte/contracts';
import type { IndexedPlace } from '../projects/project-index.ts';
import { isInside } from './project-paths.ts';
import { VerbRefusal, field } from './verb.ts';

/*
 * A ceiling on the sidebar, not a budget: a project with this many rows is one nobody can read any
 * more, and the number is here to stop an agent in a loop long before that.
 */
export const MAX_PROJECT_VIEWS = 100;

/* A device view needs a local discovery result, so agents may inspect it but cannot invent one. */
export const VIEW_KINDS = PROJECT_VIEW_KINDS.filter((kind): kind is Exclude<(typeof PROJECT_VIEW_KINDS)[number], 'device'> => kind !== 'device');

export type ViewFlag = 'path' | 'url';

// The flags that only mean something on one kind; every kind takes --after.
export const VIEW_KIND_FLAGS: Partial<Record<ProjectViewKind, ViewFlag>> = { file: 'path', browser: 'url' };

/* The prefix a fresh id gets, the same one the client's own `nextId` uses for that kind: a chat,
   terminal or browser view is a session under its own id, so it carries its kind in the id. */
export const ID_PREFIX: Partial<Record<ProjectViewKind, string>> = {
    chat: 'chat',
    terminal: 'terminal',
    browser: 'browser',
    separator: 'separator',
    subheader: 'subheader'
};

export const viewKindsFor = (flag: ViewFlag): string =>
    VIEW_KINDS.filter((kind) => VIEW_KIND_FLAGS[kind] === flag)
        .map((kind) => `${kind} (required)`)
        .join(', ');

/* The views a refusal offers instead; the caller passes the ones its verb would actually take. */
export const viewLines = (views: readonly ProjectView[]): string[] => views.map((view) => `view\t${view.id}\t${view.kind}\t${field(view.name ?? '')}`);

/*
 * Whether `view delete` would remove this view for this caller, and why: one it made itself, or any
 * view at all on a machine that says so. A view the caller is standing in is never deletable, since
 * the verb would end the session that is asking. The reason is what the `view list` column prints, so a
 * `yes` on a machine that frees everything does not read as a mistake to a caller that made none of them.
 */
export const deleteReason = (view: ProjectView, call: { caller: string; place: IndexedPlace; anyView: boolean }): { may: boolean; why: string } => {
    if (view.id === call.caller || view.id === call.place.canvasId) {
        return { may: false, why: 'you are in it' };
    }
    if (view.createdBy === call.caller) {
        return { may: true, why: 'yours' };
    }
    if (call.anyView) {
        return { may: true, why: 'this machine frees every view' };
    }
    return { may: false, why: view.createdBy === undefined ? 'a person made it' : `${view.createdBy} made it` };
};

export const deletableView = (view: ProjectView, call: { caller: string; place: IndexedPlace; anyView: boolean }): boolean => deleteReason(view, call).may;

/* The icon names in rows of ten: sixty of them one per line would bury the refusal they belong to. */
export const ICON_NAME_LINES = Array.from({ length: Math.ceil(PROJECT_ICON_NAMES.length / 10) }, (_, row) =>
    ['icons', ...PROJECT_ICON_NAMES.slice(row * 10, row * 10 + 10)].join('\t')
);

/* A Lucide name from the closed set. Anything else is refused with the set, which is the answer to
   both a typo and a mark of one's own: a view wears one of these names or the mark of its kind. */
export const iconChoice = (value: string): ProjectIconChoice => {
    if ((PROJECT_ICON_NAMES as readonly string[]).includes(value)) {
        return { kind: 'lucide', value: value as (typeof PROJECT_ICON_NAMES)[number] };
    }
    throw new VerbRefusal('unknown-icon', `${value} is not one of the ${PROJECT_ICON_NAMES.length} Lucide names a view picks from`, ICON_NAME_LINES);
};

/* The view an id names, refused with the list when it names none: the views are a closed set. */
export const viewNamed = (content: ProjectContent, id: string, flag: string): ProjectView => {
    const view = content.views.find((candidate) => candidate.id === id);
    if (!view) {
        throw new VerbRefusal('unknown-view', `${id} is not a view of this project`, [
            ...viewLines(content.views),
            `note\t${flag} takes a view id, never a name`
        ]);
    }
    return view;
};

/* A path stays inside the project folder as a stored one, and stays absolute when it points out. */
export const storedFilePath = (folder: string, path: string): string => (folder !== null && isInside(folder, path) ? storedPathOf(folder, path) : path);

export const madeView = (
    kind: (typeof VIEW_KINDS)[number],
    id: string,
    name: string,
    createdBy: string,
    parts: { url?: string; path?: string }
): ProjectView => {
    if (kind === 'canvas') {
        return { ...emptyCanvasView(id, name), createdBy };
    }
    if (kind === 'separator' || kind === 'subheader') {
        return { kind, id, name, createdBy };
    }
    if (kind === 'chat' || kind === 'terminal') {
        return { kind, id, name, node: {}, createdBy };
    }
    if (kind === 'browser') {
        return { kind, id, name, url: parts.url!, createdBy };
    }
    if (kind === 'file') {
        return { kind, id, name, path: parts.path!, createdBy };
    }
    return { kind, id, name, createdBy };
};

/* Why this view stays. Every sentence names the way out, since the caller cannot read the machine. */
export const refuseUndeletable = (view: ProjectView, call: { caller: string; place: IndexedPlace; anyView: boolean }): void => {
    if (deletableView(view, call)) {
        return;
    }
    if (view.id === call.caller || view.id === call.place.canvasId) {
        throw new VerbRefusal('deletes-caller', `You are in ${view.id}, so removing it would end the session asking`);
    }
    throw new VerbRefusal('not-yours', `${view.id} was made by ${view.createdBy ?? 'a person'} and view delete only removes a view you made yourself`, [
        `made by\t${view.createdBy ?? 'a person'}`,
        `you\t${call.caller}`,
        "setting\tagentsDeleteAnyView in this machine's endpoint.json frees every view; a person turns it on from the Machines pane"
    ]);
};
