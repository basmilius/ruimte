import { isAbsolute, join, resolve } from 'node:path';
import {
    LAUNCHES_VERSION,
    LaunchesPrivateFileSchema,
    LaunchesSharedFileSchema,
    launchPortOf,
    newerVersionIn,
    readLaunchEntries,
    type LaunchConfig,
    type LaunchConfigEntry,
    type LaunchConfigOverlay,
    type LaunchFileEntry,
    type LaunchesDocument,
    type LaunchSuggestion,
    type LaunchesPrivateFile,
    type LaunchesSharedFile
} from '@ruimte/contracts';
import { CodedError } from '@adecore/agents/coded-error';
import { Serializer } from '@adecore/agents/serializer';
import { settled, SYSTEM_WATCH, type DirectoryWatcher, type Settled, type WatchSeams } from '@adecore/agents/watch-seam';
import { isInside } from '../canvas/project-paths.ts';
import { listRepos } from '../git/repos.ts';
import { ClientSinks } from '../client-sinks.ts';
import { errorText } from '../error-text.ts';
import {
    PRIVATE_DIR,
    PROJECT_DIR,
    PROJECT_FILE,
    readJsonDocument,
    tooNewMessage,
    writeGitignoreIfMissing,
    writeJsonDocument,
    type JsonDocumentParse,
    type JsonDocumentRead
} from '../projects/project-files.ts';
import type { SessionSink } from '../sessions/manager.ts';
import { detectLaunches } from './detect.ts';

export const LAUNCHES_FILE = 'launches.json';

// The burst rule of the other project files: git and editors write more than once per save.
const WATCH_SETTLE_MS = 150;

export type LaunchErrorCode =
    | 'project-not-found'
    | 'launch-not-found'
    | 'launches-invalid'
    | 'rev-conflict'
    | 'cwd-outside-project'
    | 'bad-cwd'
    | 'launch-held'
    | 'launch-stuck';

export class LaunchError extends CodedError<LaunchErrorCode> {}

/* What the store needs of the projects: where a project lives on this machine. */
export interface LaunchProjects {
    /* The folder of a project this machine knows, open or not; null for one it does not. */
    folderOf(projectId: string): string | null;
    /* The worktrees of the repository the folder is in, which a launch may run in as an agent's --cwd may. */
    worktreePaths(folder: string): Promise<string[]>;
}

/* What the store needs of the approvals: `CommandApprovals`, keyed on a launch instead of a node. */
export interface LaunchApprovals {
    has(folder: string, nodeId: string, command: string): boolean;
    approve(folder: string, nodeId: string, command: string): Promise<void>;
}

/* A launch as it runs on this machine: its overlay laid over it and its folder made absolute. */
export interface ResolvedLaunch {
    projectId: string;
    folder: string;
    launch: LaunchConfig;
    shared: boolean;
    cwd: string;
    command: string;
    env: Record<string, string>;
    url: string | null;
    port: number | null;
    approved: boolean;
}

interface LoadedLaunches {
    folder: string;
    rev: number;
    // The exact text last read or written, so the watcher tells our own write from someone else's.
    sharedText: string;
    privateText: string;
    shared: LaunchFileEntry[];
    // The top level of each file past what this release reads, written back as it was.
    sharedRest: Record<string, unknown>;
    private: LaunchFileEntry[];
    privateRest: Record<string, unknown>;
    order: string[];
    overlays: Record<string, LaunchConfigOverlay>;
    watchers: DirectoryWatcher[];
    settle: Settled | null;
}

function sharedPathIn(folder: string): string {
    return join(folder, PROJECT_DIR, LAUNCHES_FILE);
}

function privatePathIn(folder: string): string {
    return join(folder, PROJECT_DIR, PRIVATE_DIR, LAUNCHES_FILE);
}

function parseWith<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }) {
    return (text: string): JsonDocumentParse<T> => {
        let value: unknown;
        try {
            value = JSON.parse(text);
        } catch {
            return { kind: 'unreadable' };
        }
        const newer = newerVersionIn(value, LAUNCHES_VERSION);
        if (newer !== null) {
            return { kind: 'too-new', version: newer };
        }
        const parsed = schema.safeParse(value);
        return parsed.success ? { kind: 'ok', document: parsed.data } : { kind: 'unreadable' };
    };
}

const parseShared = parseWith<LaunchesSharedFile>(LaunchesSharedFileSchema);

const parsePrivate = parseWith<LaunchesPrivateFile>(LaunchesPrivateFileSchema);

function serialize(file: unknown): string {
    return `${JSON.stringify(file, null, 4)}\n`;
}

function restOf(file: Record<string, unknown>, known: readonly string[]): Record<string, unknown> {
    return Object.fromEntries(Object.entries(file).filter(([key]) => !known.includes(key)));
}

const SHARED_KEYS = ['version', 'launches'];

const PRIVATE_KEYS = ['version', 'rev', 'order', 'launches', 'overlays'];

function launchesOf(entries: readonly LaunchFileEntry[]): LaunchConfig[] {
    return entries.flatMap((entry) => ('launch' in entry ? [entry.launch] : []));
}

function rawOf(entries: readonly LaunchFileEntry[]): unknown[] {
    return entries.flatMap((entry) => ('raw' in entry ? [entry.raw] : []));
}

function stripEntry(entry: LaunchConfigEntry): LaunchConfig {
    const { shared: _shared, overlay: _overlay, ...launch } = entry;
    return launch;
}

function isEmptyOverlay(overlay: LaunchConfigOverlay | undefined): boolean {
    return (
        overlay === undefined ||
        Object.entries(overlay).every(([, value]) => value === undefined || (typeof value === 'object' && Object.keys(value as object).length === 0))
    );
}

/* The approval key: the launch and everything that decides what runs, so a change to any of them asks again. */
function approvalKeyOf(launchId: string): string {
    return `launch:${launchId}`;
}

function digestOf(resolved: Pick<ResolvedLaunch, 'command' | 'cwd' | 'env'>): string {
    return JSON.stringify([resolved.command, resolved.cwd, Object.entries(resolved.env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))]);
}

/*
 * The launches of every project on this machine: `.ruimte/launches.json`, which a team commits, and
 * `.ruimte/private/launches.json`, which holds the rev, the order of the menu over both files, this
 * person's own launches and what a shared one keeps on this machine. Every write goes against the
 * rev it read. Whether a launch may run here is not in either file: an agent with a shell can write
 * both, so the approval lives under `$RUIMTE_HOME`.
 */
export class LaunchStore {
    private readonly projects: LaunchProjects;
    private readonly approvals: LaunchApprovals;
    private readonly seams: WatchSeams;
    private readonly sinks = new ClientSinks();
    private readonly loaded = new Map<string, LoadedLaunches>();
    private readonly writes = new Serializer();

    constructor(options: { projects: LaunchProjects; approvals: LaunchApprovals; seams?: WatchSeams }) {
        this.projects = options.projects;
        this.approvals = options.approvals;
        this.seams = options.seams ?? SYSTEM_WATCH;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    read(projectId: string): Promise<LaunchesDocument> {
        return this.writes.run(async () => this.documentOf(projectId, await this.load(projectId)));
    }

    /*
     * A person's save of the whole list. Which launches are shared is theirs to say, and every launch
     * it adds or changes counts as approved on this machine, the way a `project.save` that sets a
     * terminal's command does.
     */
    save(projectId: string, baseRev: number, launches: readonly LaunchConfigEntry[]): Promise<number> {
        return this.writes.run(async () => {
            const state = await this.load(projectId);
            if (baseRev !== state.rev) {
                throw new LaunchError('rev-conflict', `The launches are at rev ${state.rev}, the save was based on ${baseRev}`);
            }
            if (await this.takeOutsideEdits(projectId, state)) {
                throw new LaunchError('rev-conflict', `The launches changed on disk; they are now at rev ${state.rev}`);
            }
            const worktrees = await this.projects.worktreePaths(state.folder).catch(() => []);
            const problem = problemIn(state.folder, worktrees, launches);
            if (problem) {
                throw new LaunchError('launches-invalid', problem);
            }
            const before = new Map(this.resolvedAll(projectId, state).map((resolved) => [resolved.launch.id, digestOf(resolved)]));

            const shared = launches.filter((entry) => entry.shared);
            const own = launches.filter((entry) => !entry.shared);
            const overlays = Object.fromEntries(shared.filter((entry) => !isEmptyOverlay(entry.overlay)).map((entry) => [entry.id, entry.overlay!]));
            const sharedFile = { version: LAUNCHES_VERSION, ...state.sharedRest, launches: [...shared.map(stripEntry), ...rawOf(state.shared)] };
            const privateFile = {
                version: LAUNCHES_VERSION,
                ...state.privateRest,
                rev: state.rev + 1,
                order: launches.map((entry) => entry.id),
                launches: [...own.map(stripEntry), ...rawOf(state.private)],
                overlays
            };
            const sharedText = serialize(sharedFile);
            // A project that never shared a launch gets no file for git to see.
            if (sharedText !== state.sharedText && (state.sharedText !== '' || sharedFile.launches.length > 0)) {
                state.sharedText = await writeJsonDocument(sharedPathIn(state.folder), sharedFile, serialize);
            }
            await writeGitignoreIfMissing(join(state.folder, PROJECT_DIR, PROJECT_FILE));
            state.privateText = await writeJsonDocument(privatePathIn(state.folder), privateFile, serialize);
            state.rev = privateFile.rev;
            state.shared = readLaunchEntries(sharedFile.launches);
            state.private = readLaunchEntries(privateFile.launches);
            state.order = privateFile.order;
            state.overlays = overlays;

            for (const resolved of this.resolvedAll(projectId, state)) {
                if (resolved.launch.kind !== 'group' && before.get(resolved.launch.id) !== digestOf(resolved)) {
                    await this.approvals.approve(state.folder, approvalKeyOf(resolved.launch.id), digestOf(resolved));
                }
            }
            this.emitChanged(projectId, state);
            return state.rev;
        });
    }

    /* A person's yes from the approval popover, for a launch as it stands now; a group approves what it starts. */
    approve(projectId: string, launchIds: readonly string[]): Promise<void> {
        return this.writes.run(async () => {
            const state = await this.load(projectId);
            for (const resolved of this.resolvedAll(projectId, state)) {
                if (launchIds.includes(resolved.launch.id) && resolved.launch.kind !== 'group') {
                    await this.approvals.approve(state.folder, approvalKeyOf(resolved.launch.id), digestOf(resolved));
                }
            }
            this.emitChanged(projectId, state);
        });
    }

    /* Every launch of a project as it would run here, in the order of the menu. */
    resolveAll(projectId: string): Promise<ResolvedLaunch[]> {
        return this.writes.run(async () => this.resolvedAll(projectId, await this.load(projectId)));
    }

    /* What the project's own files describe, in the folder and each checkout the git panel knows. */
    async detect(projectId: string): Promise<LaunchSuggestion[]> {
        const folder = this.projects.folderOf(projectId);
        if (folder === null) {
            throw new LaunchError('project-not-found', `No project ${projectId} on this machine`);
        }
        const { repos } = await listRepos(folder).catch(() => ({ repos: [] }));
        return detectLaunches(
            folder,
            repos.map((repo) => repo.path)
        );
    }

    async resolve(projectId: string, launchId: string): Promise<ResolvedLaunch> {
        const all = await this.resolveAll(projectId);
        const found = all.find((resolved) => resolved.launch.id === launchId);
        if (!found) {
            throw new LaunchError('launch-not-found', `This project has no launch ${launchId}`);
        }
        return found;
    }

    /* Stops watching a project the last client closed; the next read loads it again. */
    closeProject(projectId: string): void {
        const state = this.loaded.get(projectId);
        if (!state) {
            return;
        }
        for (const watcher of state.watchers) {
            watcher.close();
        }
        state.settle?.stop();
        this.loaded.delete(projectId);
    }

    closeAll(): void {
        for (const projectId of [...this.loaded.keys()]) {
            this.closeProject(projectId);
        }
    }

    private resolvedAll(projectId: string, state: LoadedLaunches): ResolvedLaunch[] {
        const sharedIds = new Set(launchesOf(state.shared).map((launch) => launch.id));
        return ordered(state).map((launch) => {
            const shared = sharedIds.has(launch.id);
            const overlay = shared ? state.overlays[launch.id] : undefined;
            const cwd = resolve(state.folder, overlay?.cwd ?? launch.cwd ?? '.');
            const env = { ...launch.env, ...overlay?.env };
            const command = launch.command ?? '';
            const resolved = {
                projectId,
                folder: state.folder,
                launch,
                shared,
                cwd,
                command,
                env,
                url: launch.url?.trim() ? launch.url.trim() : null,
                port: launch.kind === 'service' ? launchPortOf(launch.url) : null
            };
            return { ...resolved, approved: launch.kind !== 'group' && this.approvals.has(state.folder, approvalKeyOf(launch.id), digestOf(resolved)) };
        });
    }

    private documentOf(projectId: string, state: LoadedLaunches): LaunchesDocument {
        const resolved = this.resolvedAll(projectId, state);
        const approvedIds = new Set(resolved.filter((entry) => entry.approved).map((entry) => entry.launch.id));
        const sharedIds = new Set(launchesOf(state.shared).map((launch) => launch.id));
        for (const entry of resolved) {
            const members = entry.launch.launches ?? [];
            if (entry.launch.kind === 'group' && members.length > 0 && members.every((id) => approvedIds.has(id))) {
                approvedIds.add(entry.launch.id);
            }
        }
        return {
            rev: state.rev,
            launches: resolved.map(({ launch }) => {
                const shared = sharedIds.has(launch.id);
                const overlay = shared ? state.overlays[launch.id] : undefined;
                return { ...launch, shared, ...(overlay ? { overlay } : {}) };
            }),
            approved: resolved.filter((entry) => approvedIds.has(entry.launch.id)).map((entry) => entry.launch.id)
        };
    }

    private emitChanged(projectId: string, state: LoadedLaunches): void {
        this.sinks.emit({ event: 'launches.changed', payload: { projectId, document: this.documentOf(projectId, state) } });
    }

    private async load(projectId: string): Promise<LoadedLaunches> {
        const known = this.loaded.get(projectId);
        if (known) {
            return known;
        }
        const folder = this.projects.folderOf(projectId);
        if (folder === null) {
            throw new LaunchError('project-not-found', `No project ${projectId} on this machine`);
        }
        const state: LoadedLaunches = {
            folder,
            rev: 0,
            sharedText: '',
            privateText: '',
            shared: [],
            sharedRest: {},
            private: [],
            privateRest: {},
            order: [],
            overlays: {},
            watchers: [],
            settle: null
        };
        const [shared, own] = await Promise.all([readLaunchFile(sharedPathIn(folder), parseShared), readLaunchFile(privatePathIn(folder), parsePrivate)]);
        takeShared(state, shared);
        takePrivate(state, own);
        this.loaded.set(projectId, state);
        this.watch(projectId, state);
        return state;
    }

    /* Takes in a write the watcher has not reported yet; true when there was one. */
    private async takeOutsideEdits(projectId: string, state: LoadedLaunches): Promise<boolean> {
        const [shared, own] = await Promise.all([
            readLaunchFile(sharedPathIn(state.folder), parseShared, false),
            readLaunchFile(privatePathIn(state.folder), parsePrivate, false)
        ]);
        const sharedMoved = textOf(shared) !== null && textOf(shared) !== state.sharedText;
        const privateMoved = textOf(own) !== null && textOf(own) !== state.privateText;
        if (!sharedMoved && !privateMoved) {
            return false;
        }
        const rev = state.rev;
        if (sharedMoved) {
            takeShared(state, shared);
        }
        if (privateMoved) {
            takePrivate(state, own);
        }
        // A pull changes only the shared file, and a save against the rev from before it would write over it.
        state.rev = Math.max(state.rev, rev + 1);
        this.emitChanged(projectId, state);
        return true;
    }

    private watch(projectId: string, state: LoadedLaunches): void {
        state.settle = settled(this.seams, WATCH_SETTLE_MS, () =>
            this.writes
                .run(async () => {
                    if (this.loaded.get(projectId) === state) {
                        await this.takeOutsideEdits(projectId, state);
                    }
                })
                .catch((e: unknown) => {
                    console.warn(`An outside edit to the launches of ${state.folder} could not be taken in:`, errorText(e));
                })
        );
        const settle = state.settle;
        state.watchers = [join(state.folder, PROJECT_DIR), join(state.folder, PROJECT_DIR, PRIVATE_DIR)]
            .map((dir) => {
                try {
                    const watcher = this.seams.watch(dir, { recursive: false }, (_event, filename) => {
                        if (filename === null || filename.endsWith(LAUNCHES_FILE)) {
                            settle.nudge();
                        }
                    });
                    watcher.on('error', () => undefined);
                    return watcher;
                } catch {
                    // A folder that is not there yet has nothing to watch; a save still works.
                    return null;
                }
            })
            .filter((watcher) => watcher !== null);
    }
}

type LaunchFileRead<T> = JsonDocumentRead<T>;

/* A file from a newer Ruimte is refused, never set aside: a later release reads it. */
async function readLaunchFile<T>(path: string, parse: (text: string) => JsonDocumentParse<T>, setAside = true): Promise<LaunchFileRead<T>> {
    const read = await readJsonDocument(path, parse, { setAside });
    if (read.kind === 'too-new') {
        throw new LaunchError('launches-invalid', tooNewMessage('launch file', read.version, LAUNCHES_VERSION));
    }
    if (read.kind === 'corrupt') {
        console.warn(`Set aside a launch file that would not parse: ${read.setAside}`);
    }
    return read;
}

function textOf<T>(read: LaunchFileRead<T>): string | null {
    return read.kind === 'ok' ? read.text : read.kind === 'missing' ? '' : null;
}

function takeShared(state: LoadedLaunches, read: LaunchFileRead<LaunchesSharedFile>): void {
    if (read.kind !== 'ok') {
        state.sharedText = read.kind === 'missing' ? '' : state.sharedText;
        state.shared = read.kind === 'missing' ? [] : state.shared;
        return;
    }
    state.sharedText = read.text;
    state.shared = readLaunchEntries(read.document.launches);
    state.sharedRest = restOf(read.document, SHARED_KEYS);
}

function takePrivate(state: LoadedLaunches, read: LaunchFileRead<LaunchesPrivateFile>): void {
    if (read.kind !== 'ok') {
        if (read.kind === 'missing') {
            state.privateText = '';
            state.private = [];
            state.order = [];
            state.overlays = {};
        }
        return;
    }
    state.privateText = read.text;
    state.rev = read.document.rev;
    state.private = readLaunchEntries(read.document.launches ?? []);
    state.order = read.document.order ?? [];
    state.overlays = read.document.overlays ?? {};
    state.privateRest = restOf(read.document, PRIVATE_KEYS);
}

/* The launches of both files in the order of the menu; one the order does not name goes after, shared first. */
function ordered(state: LoadedLaunches): LaunchConfig[] {
    const all = [...launchesOf(state.shared), ...launchesOf(state.private)];
    const seen = new Set<string>();
    const unique = all.filter((launch) => {
        if (seen.has(launch.id)) {
            return false;
        }
        seen.add(launch.id);
        return true;
    });
    const rank = new Map(state.order.map((id, index) => [id, index]));
    return unique
        .map((launch, index) => ({ launch, index }))
        .sort((a, b) => (rank.get(a.launch.id) ?? state.order.length + a.index) - (rank.get(b.launch.id) ?? state.order.length + b.index))
        .map(({ launch }) => launch);
}

/*
 * The first rule a list of launches breaks, or null. A folder is held to the project here as far as
 * the words go; the start holds it to the real path again, since a symlink can move in between.
 */
export function problemIn(folder: string, worktrees: readonly string[], launches: readonly LaunchConfigEntry[]): string | null {
    const ids = new Set<string>();
    for (const launch of launches) {
        if (ids.has(launch.id)) {
            return `Two launches share the id "${launch.id}"`;
        }
        ids.add(launch.id);
    }
    const kinds = new Map(launches.map((launch) => [launch.id, launch.kind]));
    for (const launch of launches) {
        if (launch.kind === 'group') {
            const members = launch.launches ?? [];
            if (members.length === 0) {
                return `The group "${launch.name}" starts no launch`;
            }
            const missing = members.find((id) => !kinds.has(id));
            if (missing !== undefined) {
                return `The group "${launch.name}" starts "${missing}", which is not a launch`;
            }
            if (members.some((id) => kinds.get(id) === 'group')) {
                return `The group "${launch.name}" starts another group; a group only starts launches`;
            }
            continue;
        }
        if (!launch.command?.trim()) {
            return `The launch "${launch.name}" has no command`;
        }
        for (const cwd of [launch.cwd, launch.overlay?.cwd]) {
            if (cwd === undefined) {
                continue;
            }
            const path = isAbsolute(cwd) ? cwd : resolve(folder, cwd);
            if (!isInside(folder, path) && !worktrees.some((root) => isInside(root, path))) {
                return `The folder of "${launch.name}" is outside the project: ${path}`;
            }
        }
        if (launch.shared && launch.cwd !== undefined && isAbsolute(launch.cwd)) {
            return `The folder of "${launch.name}" is an absolute path, which does not travel with the project; keep it on this machine`;
        }
    }
    return null;
}
