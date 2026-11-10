import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, sep } from 'node:path';
import { CodedError, SYSTEM_WATCH, type DirectoryWatcher, type Settled, type WatchSeams } from '@adecore/agents';
import { Serializer } from '@adecore/utils/async';
import { climbsOut, isWithin } from '@adecore/utils/path';
import {
    PRIVATE_DIR,
    PROJECT_DIR,
    isSecretReference,
    LAUNCH_SECRET_REFERENCE,
    LAUNCHES_VERSION,
    LaunchesPrivateFileSchema,
    LaunchesSharedFileSchema,
    launchCwdOf,
    launchGap,
    launchPortOf,
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
import { ClientSinks } from '../client-sinks.ts';
import { errorText } from '../error-text.ts';
import { cachedRepos } from '../git/repo-cache.ts';
import {
    PROJECT_FILE,
    readJsonDocument,
    inPersonalOrder,
    restOf,
    serializeJson as serialize,
    tooNewMessage,
    versionedParser,
    takeMovedFiles,
    watchOutsideEdits,
    writeGitignoreIfMissing,
    writeJsonDocument,
    type JsonDocumentParse,
    closeLoaded,
    type JsonDocumentRead
} from '../projects/project-files.ts';
import type { SessionSink } from '../wire.ts';
import { detectLaunches } from './detect.ts';

const LAUNCHES_FILE = 'launches.json';

type LaunchErrorCode =
    | 'project-not-found'
    | 'launch-not-found'
    | 'launches-invalid'
    | 'rev-conflict'
    | 'cwd-outside-project'
    | 'bad-cwd'
    | 'launch-held'
    | 'launch-stuck'
    | 'launch-not-a-task'
    | 'no-after-settle';

export class LaunchError extends CodedError<LaunchErrorCode> {}

/* What the store needs of the projects: where a project lives on this machine. */
interface LaunchProjects {
    /* The folder of a project this machine knows, open or not; null for one it does not. */
    folderOf(projectId: string): string | null;
    /* The worktrees of the repository the folder is in, which a launch may run in as an agent's cwd may. */
    worktreePaths(folder: string): Promise<string[]>;
}

/* What the store needs of the approvals: `CommandApprovals`, keyed on a launch instead of a node. */
interface LaunchApprovals {
    has(folder: string, nodeId: string, command: string): boolean;
    approve(folder: string, nodeId: string, command: string): Promise<void>;
}

/* What the store tells the secrets: which of them the launches still refer to, after a person's save. */
interface LaunchSecrets {
    retain(projectId: string, referenced: readonly { launchId: string; variable: string }[]): Promise<void>;
}

/* The task a person chose to run after a worktree chat settles, per project, under `$RUIMTE_HOME` (`after-settle.ts`). */
export interface AfterSettleChoices {
    choiceOf(projectId: string): { launchId: string } | null;
    choose(projectId: string, launchId: string | null): Promise<void>;
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

const parseShared = versionedParser<LaunchesSharedFile>(LaunchesSharedFileSchema, LAUNCHES_VERSION);
const parsePrivate = versionedParser<LaunchesPrivateFile>(LaunchesPrivateFileSchema, LAUNCHES_VERSION);

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

function approvalKeyOf(launchId: string): string {
    return `launch:${launchId}`;
}

function worktreesKeyOf(launchId: string): string {
    return `launch-worktrees:${launchId}`;
}

/*
 * What a run in a worktree is approved as: the command, the environment and the folder relative to the
 * project, since the worktree itself differs from run to run. Null for a launch that runs outside the
 * project folder, which has no place in a worktree.
 */
function worktreesDigestOf(resolved: Pick<ResolvedLaunch, 'folder' | 'command' | 'cwd' | 'env'>): string | null {
    const inside = relative(resolved.folder, resolved.cwd);
    if (climbsOut(inside)) {
        return null;
    }
    return JSON.stringify(['worktrees', resolved.command, inside.split(sep).join('/'), sortedEnv(resolved.env)]);
}

function sortedEnv(env: Record<string, string>): [string, string][] {
    return Object.entries(env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/* The digest of a launch that may run in a worktree at all, refused for any other. */
function worktreesDigestIn(resolved: ResolvedLaunch): string {
    if (resolved.launch.kind !== 'task' || resolved.command.trim() === '') {
        throw new LaunchError('launch-not-a-task', `${resolved.launch.name} is no task with a command, and only a task runs after a chat settles`);
    }
    const digest = worktreesDigestOf(resolved);
    if (digest === null) {
        throw new LaunchError('cwd-outside-project', `${resolved.launch.name} runs outside the project folder, so it has no place in a worktree`);
    }
    return digest;
}

/* Everything that decides what runs, approved as one, so a change to any of it asks again. */
function digestOf(resolved: Pick<ResolvedLaunch, 'command' | 'cwd' | 'env'>): string {
    return JSON.stringify([resolved.command, resolved.cwd, sortedEnv(resolved.env)]);
}

/* A short fingerprint of everything a launch's approval covers, for an id that has to name exactly what was listed. */
export function launchDigest(resolved: Pick<ResolvedLaunch, 'command' | 'cwd' | 'env'>): string {
    return createHash('sha256').update(digestOf(resolved)).digest('hex').slice(0, 32);
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
    private readonly secrets: LaunchSecrets | null;
    private readonly afterSettle: AfterSettleChoices | null;
    private readonly seams: WatchSeams;
    private readonly sinks = new ClientSinks();
    private readonly loaded = new Map<string, LoadedLaunches>();
    private readonly writes = new Serializer();

    constructor(options: {
        projects: LaunchProjects;
        approvals: LaunchApprovals;
        secrets?: LaunchSecrets;
        afterSettle?: AfterSettleChoices;
        seams?: WatchSeams;
    }) {
        this.projects = options.projects;
        this.approvals = options.approvals;
        this.secrets = options.secrets ?? null;
        this.afterSettle = options.afterSettle ?? null;
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
     * terminal's command does. The ids in `imported` are the exception: an import read them from a file
     * nobody on this machine wrote them in, so the first run asks.
     */
    save(projectId: string, baseRev: number, launches: readonly LaunchConfigEntry[], imported: readonly string[] = []): Promise<number> {
        return this.writes.run(async () => {
            const state = await this.load(projectId);
            if (baseRev !== state.rev) {
                throw new LaunchError('rev-conflict', `The launches are at rev ${state.rev}, the save was based on ${baseRev}`);
            }
            if (await this.takeOutsideEdits(projectId, state)) {
                throw new LaunchError('rev-conflict', `The launches changed on disk; they are now at rev ${state.rev}`);
            }
            const before = new Map(this.resolvedAll(projectId, state).map((resolved) => [resolved.launch.id, digestOf(resolved)]));
            await this.writeEntries(state, launches);

            const after = this.resolvedAll(projectId, state);
            for (const resolved of after) {
                if (resolved.launch.kind !== 'group' && !imported.includes(resolved.launch.id) && before.get(resolved.launch.id) !== digestOf(resolved)) {
                    await this.approvals.approve(state.folder, approvalKeyOf(resolved.launch.id), digestOf(resolved));
                }
            }
            // A person removing a secret's variable, or its launch, removes the secret too.
            await this.secrets?.retain(projectId, secretSlotsOf(after)).catch((e: unknown) => {
                console.error(`Dropping the unused secrets of ${projectId} failed:`, errorText(e));
            });
            this.emitChanged(projectId, state);
            return state.rev;
        });
    }

    /*
     * An agent's save of one launch, new or changed, through a tool. It approves nothing, so the launch
     * is held until a person approves it as it stands. A launch that exists stays in its file with its
     * overlay; a new one goes where `shared` says. It never drops a secret, which only a person does.
     */
    saveByAgent(projectId: string, launch: LaunchConfig, shared: boolean): Promise<number> {
        return this.writes.run(async () => {
            const state = await this.load(projectId);
            await this.takeOutsideEdits(projectId, state);
            const entries = this.documentOf(projectId, state).launches;
            const index = entries.findIndex((entry) => entry.id === launch.id);
            const existing = entries[index];
            const entry: LaunchConfigEntry =
                existing === undefined
                    ? { ...launch, shared }
                    : { ...launch, shared: existing.shared, ...(existing.overlay === undefined ? {} : { overlay: existing.overlay }) };
            await this.writeEntries(state, existing === undefined ? [...entries, entry] : entries.with(index, entry));
            this.emitChanged(projectId, state);
            return state.rev;
        });
    }

    /* Writes the whole list in the files it says, against the state as loaded, after the same checks for every save. */
    private async writeEntries(state: LoadedLaunches, launches: readonly LaunchConfigEntry[]): Promise<void> {
        const worktrees = await this.projects.worktreePaths(state.folder).catch(() => []);
        const problem = problemIn(state.folder, worktrees, launches);
        if (problem) {
            throw new LaunchError('launches-invalid', problem);
        }
        const shared = launches.filter((entry) => entry.shared);
        const own = launches.filter((entry) => !entry.shared);
        const overlays = Object.fromEntries(shared.filter((entry) => !isEmptyOverlay(entry.overlay)).map((entry) => [entry.id, entry.overlay!]));
        const sharedFile = { version: LAUNCHES_VERSION, ...state.sharedRest, launches: [...shared.map(stripEntry), ...rawOf(state.shared)] };
        const sharedText = serialize(sharedFile);
        // A project that never shared a launch gets no file for git to see.
        if (sharedText !== state.sharedText && (state.sharedText !== '' || sharedFile.launches.length > 0)) {
            state.sharedText = await writeJsonDocument(sharedPathIn(state.folder), sharedFile, serialize);
        }
        state.shared = readLaunchEntries(sharedFile.launches);
        await this.writePrivate(
            state,
            own.map(stripEntry),
            launches.map((entry) => entry.id),
            overlays
        );
    }

    /* Writes the private file at the next rev, with the entries this release cannot read kept after the given ones. */
    private async writePrivate(
        state: LoadedLaunches,
        own: readonly LaunchConfig[],
        order: string[],
        overlays: Record<string, LaunchConfigOverlay>
    ): Promise<void> {
        const privateFile = {
            version: LAUNCHES_VERSION,
            ...state.privateRest,
            rev: state.rev + 1,
            order,
            launches: [...own, ...rawOf(state.private)],
            overlays
        };
        await writeGitignoreIfMissing(join(state.folder, PROJECT_DIR, PROJECT_FILE));
        state.privateText = await writeJsonDocument(privatePathIn(state.folder), privateFile, serialize);
        state.rev = privateFile.rev;
        state.private = readLaunchEntries(privateFile.launches);
        state.order = order;
        state.overlays = overlays;
    }

    private resolvedOne(projectId: string, state: LoadedLaunches, launchId: string): ResolvedLaunch {
        const found = this.resolvedAll(projectId, state).find((resolved) => resolved.launch.id === launchId);

        if (!found) {
            throw new LaunchError('launch-not-found', `This project has no launch ${launchId}`);
        }

        return found;
    }

    /*
     * A person saved a secret for a variable of a launch through a card: the variable becomes a
     * reference to it, in this machine's own file, since the secret never travels with the project.
     * That save is the person's yes to the change in environment, but only for a launch that was
     * approved as it stood; anything else about it still waits on the launch chip.
     */
    bindSecret(projectId: string, launchId: string, variable: string): Promise<void> {
        return this.writes.run(async () => {
            const state = await this.load(projectId);
            await this.takeOutsideEdits(projectId, state);
            const current = this.resolvedAll(projectId, state).find((resolved) => resolved.launch.id === launchId);
            if (!current || current.launch.kind === 'group') {
                throw new LaunchError('launch-not-found', `This project has no launch ${launchId} to keep a secret for`);
            }
            if (isSecretReference(current.env[variable])) {
                return;
            }
            const wasApproved = current.approved;
            let overlays = state.overlays;
            let own = launchesOf(state.private);
            if (current.shared) {
                const overlay = state.overlays[launchId] ?? {};
                overlays = { ...state.overlays, [launchId]: { ...overlay, env: { ...overlay.env, [variable]: LAUNCH_SECRET_REFERENCE } } };
            } else {
                own = own.map((launch) => (launch.id === launchId ? { ...launch, env: { ...launch.env, [variable]: LAUNCH_SECRET_REFERENCE } } : launch));
            }
            await this.writePrivate(state, own, state.order, overlays);
            if (wasApproved) {
                await this.approvals.approve(state.folder, approvalKeyOf(launchId), digestOf(this.resolvedOne(projectId, state, launchId)));
            }
            this.emitChanged(projectId, state);
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

    /*
     * An answer given for a launch as it was listed: approves only while what would run still hashes to `digest`, and says whether it
     * did. A launch edited between the list and the yes stays unapproved.
     */
    approveIfUnchanged(projectId: string, launchId: string, digest: string): Promise<boolean> {
        return this.writes.run(async () => {
            const state = await this.load(projectId);
            const resolved = this.resolvedAll(projectId, state).find((entry) => entry.launch.id === launchId);

            if (resolved === undefined || resolved.launch.kind === 'group' || launchDigest(resolved) !== digest) {
                return false;
            }

            await this.approvals.approve(state.folder, approvalKeyOf(launchId), digestOf(resolved));
            this.emitChanged(projectId, state);

            return true;
        });
    }

    /*
     * A person's choice of the task to run in a worktree chat's worktree once its turn settles, or of
     * none. Choosing one approves its command and environment for the project's worktrees as they
     * stand now, the way a save approves what it changes.
     */
    chooseAfterSettle(projectId: string, launchId: string | null): Promise<void> {
        return this.writes.run(async () => {
            if (this.afterSettle === null) {
                throw new LaunchError('no-after-settle', 'This machine runs no launch after a chat settles');
            }
            const state = await this.load(projectId);
            if (launchId !== null) {
                await this.approvals.approve(state.folder, worktreesKeyOf(launchId), worktreesDigestIn(this.resolvedOne(projectId, state, launchId)));
            }
            await this.afterSettle.choose(projectId, launchId);
            this.emitChanged(projectId, state);
        });
    }

    /* A task as it would run in the project folder of a worktree, and whether a person approved it for worktrees as it stands. */
    inWorktree(projectId: string, launchId: string, worktreeFolder: string): Promise<ResolvedLaunch> {
        return this.writes.run(async () => {
            const state = await this.load(projectId);
            const resolved = this.resolvedOne(projectId, state, launchId);
            const digest = worktreesDigestIn(resolved);
            return {
                ...resolved,
                cwd: join(worktreeFolder, relative(state.folder, resolved.cwd)),
                approved: this.approvals.has(state.folder, worktreesKeyOf(launchId), digest)
            };
        });
    }

    resolveAll(projectId: string): Promise<ResolvedLaunch[]> {
        return this.writes.run(async () => this.resolvedAll(projectId, await this.load(projectId)));
    }

    /* What the project's own files describe, in the folder and each checkout the git panel knows. */
    async detect(projectId: string, sources?: readonly string[]): Promise<LaunchSuggestion[]> {
        const folder = this.projects.folderOf(projectId);
        if (folder === null) {
            throw new LaunchError('project-not-found', `No project ${projectId} on this machine`);
        }
        const { repos } = await cachedRepos(folder).catch(() => ({ repos: [] }));
        return detectLaunches(
            folder,
            repos.map((repo) => repo.path),
            { sources }
        );
    }

    resolve(projectId: string, launchId: string): Promise<ResolvedLaunch> {
        return this.writes.run(async () => this.resolvedOne(projectId, await this.load(projectId), launchId));
    }

    /* Stops watching a project the last client closed; the next read loads it again. */
    closeProject(projectId: string): void {
        closeLoaded(this.loaded, projectId);
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
            const cwd = launchCwdOf(state.folder, { cwd: launch.cwd, overlay });
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
        for (const entry of resolved) {
            const members = entry.launch.launches ?? [];
            if (entry.launch.kind === 'group' && members.length > 0 && members.every((id) => approvedIds.has(id))) {
                approvedIds.add(entry.launch.id);
            }
        }
        return {
            rev: state.rev,
            launches: resolved.map(({ launch, shared }) => {
                const overlay = shared ? state.overlays[launch.id] : undefined;
                return { ...launch, shared, ...(overlay ? { overlay } : {}) };
            }),
            approved: resolved.filter((entry) => approvedIds.has(entry.launch.id)).map((entry) => entry.launch.id),
            ...this.afterSettleOf(projectId, state.folder, resolved)
        };
    }

    private afterSettleOf(projectId: string, folder: string, resolved: readonly ResolvedLaunch[]): Pick<LaunchesDocument, 'afterSettle'> {
        const launchId = this.afterSettle?.choiceOf(projectId)?.launchId;
        const chosen = resolved.find((entry) => entry.launch.id === launchId);
        if (!chosen) {
            return {};
        }
        const digest = worktreesDigestOf(chosen);
        const approved = chosen.launch.kind === 'task' && digest !== null && this.approvals.has(folder, worktreesKeyOf(chosen.launch.id), digest);
        return { afterSettle: { launchId: chosen.launch.id, approved } };
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
        if (!takeMovedFiles(state, shared, own, takeShared, takePrivate)) {
            return false;
        }
        this.emitChanged(projectId, state);
        return true;
    }

    private watch(projectId: string, state: LoadedLaunches): void {
        const { settle, watchers } = watchOutsideEdits({
            seams: this.seams,
            writes: this.writes,
            folder: state.folder,
            file: LAUNCHES_FILE,
            what: 'launches',
            current: () => this.loaded.get(projectId) === state,
            take: () => this.takeOutsideEdits(projectId, state)
        });
        state.settle = settle;
        state.watchers = watchers;
    }
}

function secretSlotsOf(launches: readonly ResolvedLaunch[]): { launchId: string; variable: string }[] {
    return launches.flatMap((resolved) =>
        Object.entries(resolved.env)
            .filter(([, value]) => isSecretReference(value))
            .map(([variable]) => ({ launchId: resolved.launch.id, variable }))
    );
}

/* A file from a newer Ruimte is refused, never set aside: a later release reads it. */
async function readLaunchFile<T>(path: string, parse: (text: string) => JsonDocumentParse<T>, setAside = true): Promise<JsonDocumentRead<T>> {
    const read = await readJsonDocument(path, parse, { setAside });
    if (read.kind === 'too-new') {
        throw new LaunchError('launches-invalid', tooNewMessage('launch file', read.version, LAUNCHES_VERSION));
    }
    if (read.kind === 'corrupt') {
        console.warn(`Set aside a launch file that would not parse: ${read.setAside}`);
    }
    return read;
}

function takeShared(state: LoadedLaunches, read: JsonDocumentRead<LaunchesSharedFile>): void {
    if (read.kind !== 'ok') {
        if (read.kind === 'missing') {
            state.sharedText = '';
            state.shared = [];
        }
        return;
    }
    state.sharedText = read.text;
    state.shared = readLaunchEntries(read.document.launches);
    state.sharedRest = restOf(read.document, SHARED_KEYS);
}

function takePrivate(state: LoadedLaunches, read: JsonDocumentRead<LaunchesPrivateFile>): void {
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

function ordered(state: LoadedLaunches): LaunchConfig[] {
    return inPersonalOrder([...launchesOf(state.shared), ...launchesOf(state.private)], state.order);
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
        const gap = launchGap(launch);
        if (launch.kind === 'group') {
            const members = launch.launches ?? [];
            if (gap === 'members') {
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
        if (gap === 'command') {
            return `The launch "${launch.name}" has no command`;
        }
        for (const cwd of [launch.cwd, launch.overlay?.cwd]) {
            if (cwd === undefined) {
                continue;
            }
            const path = launchCwdOf(folder, { cwd });
            if (!isWithin(folder, path) && !worktrees.some((root) => isWithin(root, path))) {
                return `The folder of "${launch.name}" is outside the project: ${path}`;
            }
        }
        if (launch.shared && launch.cwd !== undefined && isAbsolute(launch.cwd)) {
            return `The folder of "${launch.name}" is an absolute path, which does not travel with the project; keep it on this machine`;
        }
    }
    return null;
}
