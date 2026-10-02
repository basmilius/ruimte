import i18next from 'i18next';
import type { GitRepo, LaunchConfigEntry, LaunchConfigKind, LaunchesDocument, LaunchSuggestion } from '@ruimte/contracts';

/* The daemon's import writes ids the same way, so an imported launch and a typed one read alike. */
export const slugOf = (name: string): string =>
    name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'launch';

export const uniqueId = (name: string, taken: ReadonlySet<string>): string => {
    const base = slugOf(name);
    if (!taken.has(base)) {
        return base;
    }
    for (let i = 2; ; i += 1) {
        const candidate = `${base}-${i}`;
        if (!taken.has(candidate)) {
            return candidate;
        }
    }
};

export interface EnvRow {
    /* Holds a row in place while its key is typed and a row above it goes. */
    id: number;
    key: string;
    value: string;
}

/*
 * A launch while the dialog edits it. The environment is a list, since a key being typed is not a
 * key yet, and a new launch has a stand-in id until the save names it after the launch.
 */
export interface LaunchDraft {
    entry: LaunchConfigEntry;
    env: EnvRow[];
    fresh: boolean;
}

export const draftOf = (entry: LaunchConfigEntry): LaunchDraft => ({
    entry,
    env: Object.entries(entry.env ?? {}).map(([key, value], id) => ({ id, key, value })),
    fresh: false
});

export const emptyRow = (rows: readonly EnvRow[]): EnvRow => ({ id: Math.max(-1, ...rows.map((row) => row.id)) + 1, key: '', value: '' });

export const newDraft = (id: string, kind: LaunchConfigKind): LaunchDraft => ({
    entry: { id, name: '', kind, shared: false },
    env: [],
    fresh: true
});

/* A launch with only the fields its kind reads, so a launch that was a group once keeps no command. */
const tidy = (draft: LaunchDraft, id: string, rename: ReadonlyMap<string, string>): LaunchConfigEntry => {
    const { cwd, command, url, launches, autostart, ...rest } = draft.entry;
    const entry: LaunchConfigEntry = { ...rest, id, name: rest.name.trim() };
    delete entry.env;
    if (autostart === true) {
        entry.autostart = true;
    }
    if (entry.kind === 'group') {
        entry.launches = (launches ?? []).map((member) => rename.get(member) ?? member);
        return entry;
    }
    entry.command = (command ?? '').trim();
    const folder = (cwd ?? '').trim().replace(/\/+$/, '');
    if (folder !== '' && folder !== '.') {
        entry.cwd = folder;
    }
    if (entry.kind === 'service' && url !== undefined && url.trim() !== '') {
        entry.url = url.trim();
    }
    const env = Object.fromEntries(draft.env.filter((row) => row.key.trim() !== '').map((row) => [row.key.trim(), row.value]));
    if (Object.keys(env).length > 0) {
        entry.env = env;
    }
    return entry;
};

/* What the dialog saves: every launch tidied, and each new one named after itself. */
export const savedLaunches = (drafts: readonly LaunchDraft[]): LaunchConfigEntry[] => {
    const taken = new Set(drafts.filter((draft) => !draft.fresh).map((draft) => draft.entry.id));
    const rename = new Map<string, string>();
    for (const draft of drafts) {
        if (draft.fresh) {
            const id = uniqueId(draft.entry.name, taken);
            taken.add(id);
            rename.set(draft.entry.id, id);
        }
    }
    return drafts.map((draft) => tidy(draft, rename.get(draft.entry.id) ?? draft.entry.id, rename));
};

export type DraftProblem = 'name' | 'command' | 'members';

/* The first launch the dialog cannot save, so it can show that one; the daemon checks the rest. */
export const draftProblem = (drafts: readonly LaunchDraft[]): { id: string; problem: DraftProblem } | null => {
    for (const { entry } of drafts) {
        if (entry.name.trim() === '') {
            return { id: entry.id, problem: 'name' };
        }
        if (entry.kind === 'group' ? (entry.launches ?? []).length === 0 : (entry.command ?? '').trim() === '') {
            return { id: entry.id, problem: entry.kind === 'group' ? 'members' : 'command' };
        }
    }
    return null;
};

/* A launch that goes gets out of every group that started it. */
export const withoutDraft = (drafts: readonly LaunchDraft[], id: string): LaunchDraft[] =>
    drafts
        .filter((draft) => draft.entry.id !== id)
        .map((draft) =>
            draft.entry.launches?.includes(id) === true
                ? { ...draft, entry: { ...draft.entry, launches: draft.entry.launches.filter((member) => member !== id) } }
                : draft
        );

/* The folders a launch picks from: the project folder itself (''), then each checkout inside it, by its path there. */
export const folderRoots = (repos: readonly GitRepo[]): string[] => [
    '',
    ...repos.filter((repo) => repo.kind !== 'root' && !repo.label.startsWith('/') && !repo.label.startsWith('..')).map((repo) => repo.label)
];

/* A launch's folder as the checkout it is in and the path below that. */
export const splitFolder = (cwd: string | undefined, roots: readonly string[]): { root: string; sub: string } => {
    const folder = (cwd ?? '').trim().replace(/^\.\/?/, '');
    const root = roots
        .filter((candidate) => candidate !== '' && (folder === candidate || folder.startsWith(`${candidate}/`)))
        .sort((one, other) => other.length - one.length)[0];
    return root === undefined ? { root: '', sub: folder } : { root, sub: folder.slice(root.length).replace(/^\/+/, '') };
};

export const joinFolder = (root: string, sub: string): string => {
    const below = sub.trim().replace(/^\.\/+/, '');
    if (below.startsWith('/') || root === '') {
        return below;
    }
    return below === '' ? root : `${root}/${below}`;
};

const sameRun = (launch: LaunchConfigEntry, suggestion: LaunchSuggestion): boolean =>
    launch.kind !== 'group' &&
    (launch.cwd ?? '') === (suggestion.launch.cwd ?? '') &&
    (launch.command ?? '').trim() === (suggestion.launch.command ?? '').trim();

/* What the project offers that is not a launch yet. */
export const newSuggestions = (suggestions: readonly LaunchSuggestion[], document: Pick<LaunchesDocument, 'launches'>): LaunchSuggestion[] =>
    suggestions.filter((suggestion) => !document.launches.some((launch) => sameRun(launch, suggestion)));

/*
 * The launches an import adds. Sharing is the person's choice for the lot, except for one that names a
 * path outside the project, which would not work on another machine.
 */
export const importedLaunches = (
    suggestions: readonly LaunchSuggestion[],
    share: boolean,
    document: Pick<LaunchesDocument, 'launches'>
): LaunchConfigEntry[] => {
    const taken = new Set(document.launches.map((launch) => launch.id));
    return suggestions.map((suggestion) => {
        const id = uniqueId(suggestion.launch.id, taken);
        taken.add(id);
        return { ...suggestion.launch, id, shared: share && !suggestion.private };
    });
};

/* An import from inside the editor: what was found joins the list beside the drafts, saved with them. */
export const withImported = (drafts: readonly LaunchDraft[], suggestions: readonly LaunchSuggestion[], share: boolean): LaunchDraft[] => [
    ...drafts,
    ...importedLaunches(suggestions, share, { launches: drafts.filter((draft) => !draft.fresh).map((draft) => draft.entry) }).map(draftOf)
];

const dirnameOf = (path: string): string => {
    const at = path.lastIndexOf('/');
    return at < 0 ? '.' : path.slice(0, at);
};

const placeOf = (places: ReadonlySet<string>, many: 'folders' | 'files'): string =>
    places.size === 1 ? [...places][0]! : i18next.t(`launches:found.${many}`, { count: places.size });

/* The line under "Found in this project": how many of each, and where. */
export const foundText = (suggestions: readonly LaunchSuggestion[]): string | null => {
    const usable = suggestions.filter((suggestion) => suggestion.unsupported === undefined);
    const runFiles = usable.filter((suggestion) => suggestion.source === 'run-xml');
    const scripts = usable.filter((suggestion) => suggestion.source !== 'run-xml');
    const parts = [
        ...(runFiles.length === 0
            ? []
            : [
                  i18next.t('launches:found.runFiles', {
                      count: runFiles.length,
                      place: placeOf(new Set(runFiles.map((suggestion) => dirnameOf(suggestion.path))), 'folders')
                  })
              ]),
        ...(scripts.length === 0
            ? []
            : [i18next.t('launches:found.scripts', { count: scripts.length, place: placeOf(new Set(scripts.map((suggestion) => suggestion.path)), 'files') })])
    ];
    if (parts.length === 0) {
        return null;
    }
    return parts.length === 1 ? i18next.t('launches:found.one', { first: parts[0] }) : i18next.t('launches:found.both', { first: parts[0], second: parts[1] });
};

/* Where a suggestion came from, as the import dialog writes it beside the name. */
export const suggestionSource = (suggestion: LaunchSuggestion): string => {
    if (suggestion.source === 'run-xml') {
        return suggestion.detail;
    }
    const folder = dirnameOf(suggestion.path);
    const file = suggestion.path.slice(suggestion.path.lastIndexOf('/') + 1);
    return folder === '.' ? file : `${folder} · ${file}`;
};
